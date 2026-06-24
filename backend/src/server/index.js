import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QueryEngine } from "../QueryEngine.js";
import { loadProjectConfig } from "../services/config/index.js";
import { LocalThreadStore } from "../services/threadStore/index.js";

const backendSrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.resolve(backendSrcRoot, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const frontendRoot = path.join(workspaceRoot, "frontend");
const args = readArgs(process.argv.slice(2));
const host = args.get("--host") ?? "127.0.0.1";
const port = Number(args.get("--port") ?? "3001");
const activeRuns = new Map();
const eventClients = new Map();

function readArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    result.set(argv[index], argv[index + 1]);
  }
  return result;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadConfig(modelId, body = {}) {
  const projectConfig =
    (await loadProjectConfig(workspaceRoot, readFileIfExists)) ??
    (await loadProjectConfig(frontendRoot, readFileIfExists));
  const config = projectConfig?.config ?? {};
  const model = {
    ...(config.model ?? {}),
    ...(typeof modelId === "string" && modelId.trim() ? { name: modelId.trim() } : {}),
  };

  return {
    ...config,
    model,
    permissions: {
      ...(config.permissions ?? {}),
      approvalPolicy: body.approvalPolicy ?? config.permissions?.approvalPolicy ?? "on-request",
      approvalsReviewer: body.approvalsReviewer ?? config.permissions?.approvalsReviewer ?? "user",
      sandboxMode: body.sandboxMode ?? config.permissions?.sandboxMode ?? "workspace-write",
    },
  };
}

function sendJson(res, status, data) {
  const body = data === undefined ? "" : JSON.stringify(data);
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,accept",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function writeCors(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,accept",
  });
  res.end();
}

function safeThreadId(value) {
  if (typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMessage(message, index) {
  const createdAtMs = typeof message.createdAtMs === "number" ? message.createdAtMs : undefined;
  return {
    id: stableMessageNumberId(message, index),
    role: message.role,
    text: message.content ?? "",
    time: formatMessageTime(createdAtMs),
  };
}

function stableMessageNumberId(message, index) {
  if (typeof message.id === "number" && Number.isFinite(message.id)) return message.id;
  if (typeof message.createdAtMs === "number" && Number.isFinite(message.createdAtMs)) {
    return message.createdAtMs + index;
  }
  const seed = String(message.id ?? `${message.role ?? "message"}:${message.content ?? ""}:${index}`);
  let hash = 0;
  for (let offset = 0; offset < seed.length; offset += 1) {
    hash = (hash * 31 + seed.charCodeAt(offset)) | 0;
  }
  return Math.abs(hash) + 1_000_000;
}

function formatMessageTime(createdAtMs) {
  const date = createdAtMs ? new Date(createdAtMs) : new Date();
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function addEventClient(threadId, res, runId) {
  let clients = eventClients.get(threadId);
  if (!clients) {
    clients = new Set();
    eventClients.set(threadId, clients);
  }
  clients.add(res);
  reqHeartbeat(res);
  await replayThreadEvents(threadId, res, runId);
  return () => {
    clients.delete(res);
    if (clients.size === 0) eventClients.delete(threadId);
  };
}

async function replayThreadEvents(threadId, res, runId) {
  const store = new LocalThreadStore(workspaceRoot);
  const events = await store.readEvents(threadId).catch(() => []);
  for (const event of events) {
    if (!matchesRunId(event, runId)) continue;
    writeSseEvent(res, event);
  }
}

function matchesRunId(event, runId) {
  if (!runId) return true;
  return event.runId === runId;
}

function reqHeartbeat(res) {
  res.write(": connected\n\n");
}

function broadcast(threadId, event) {
  const clients = eventClients.get(threadId);
  if (!clients) return;
  for (const res of clients) {
    writeSseEvent(res, event);
  }
}

function writeSseEvent(res, event) {
  const data = JSON.stringify(event);
  res.write(`event: agent_event\ndata: ${data}\n\n`);
}

async function listWorkspace() {
  const store = new LocalThreadStore(workspaceRoot);
  const summaries = await store.listThreadSummaries({ limit: 50 }).catch(() => []);
  return {
    chats: summaries.map((summary) => ({
      id: summary.metadata.threadId,
      title: summary.metadata.title,
      name: summary.metadata.title,
    })),
    modelGroups: modelGroups(),
  };
}

function modelGroups() {
  return [
    { provider: "MiniMax China Token Plan", models: ["MiniMax-M3"] },
    { provider: "DeepSeek", models: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"] },
    { provider: "OpenAI API", models: ["gpt-5.5", "gpt-5", "gpt-4.1"] },
  ];
}

async function readThread(threadId) {
  const store = new LocalThreadStore(workspaceRoot);
  const messages = await store.readMessages(threadId).catch(() => []);
  const events = await store.readEvents(threadId).catch(() => []);
  return {
    id: threadId,
    threadId,
    messages: messages.map(normalizeMessage),
    events,
  };
}
async function ensureThreadRecord(input) {
  const store = new LocalThreadStore(workspaceRoot);
  try {
    return await store.openThread(input.threadId, input.sessionId);
  } catch {
    return store.createThread({
      threadId: input.threadId,
      sessionId: input.sessionId,
      title: input.title,
      cwd: workspaceRoot,
      permissions: input.permissions,
    });
  }
}

async function startChatRun(input) {
  const threadId = safeThreadId(input.threadId ?? input.conversationId);
  const prompt = String(input.prompt ?? input.text ?? "").trim();
  if (!prompt) {
    throw new Error("Message text is required.");
  }

  const sessionId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const config = await loadConfig(input.modelId, input);
  await ensureThreadRecord({
    threadId,
    sessionId,
    title: prompt.slice(0, 40) || "New conversation",
    permissions: config.permissions,
  });

  let runId;
  let resolveStarted;
  let rejectStarted;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const engine = new QueryEngine({
    cwd: workspaceRoot,
    sessionId,
    threadId,
    title: prompt.slice(0, 40) || "New conversation",
    config,
    maxToolRounds: 4,
    maxTokens: 16_384,
    onEvent: (event) => {
      if (event.type === "run_started" && typeof event.runId === "string") {
        runId = event.runId;
        activeRuns.set(runId, { engine, threadId });
        resolveStarted(runId);
      }
      broadcast(threadId, event);
    },
  });

  const runPromise = engine
    .submitMessage(prompt)
    .then((output) => {
      broadcast(threadId, {
        type: "web_chat_completed",
        threadId,
        runId,
        finalText: output.finalText,
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!runId) rejectStarted(error);
      broadcast(threadId, {
        type: "web_chat_failed",
        threadId,
        runId,
        message,
      });
    })
    .finally(() => {
      if (runId) activeRuns.delete(runId);
    });

  void runPromise;
  const startedRunId = await Promise.race([
    started,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Run did not start within 5s.")), 5_000)),
  ]);

  return { ok: true, threadId, runId: startedRunId };
}

function stopRun(runId) {
  const record = activeRuns.get(runId);
  if (!record) return false;
  record.engine.abort("stopped_by_user");
  broadcast(record.threadId, {
    type: "web_chat_failed",
    threadId: record.threadId,
    runId,
    message: "Stopped by user.",
  });
  activeRuns.delete(runId);
  return true;
}

async function handleRequest(req, res) {
  if (req.method === "OPTIONS") {
    writeCors(res);
    return;
  }

  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "pando-dev-api", port });
    return;
  }

  if (req.method === "GET" && pathname === "/api/models") {
    sendJson(res, 200, { modelGroups: modelGroups() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/workspace") {
    sendJson(res, 200, await listWorkspace());
    return;
  }

  if (req.method === "GET" && pathname === "/api/goals/active") {
    sendJson(res, 204);
    return;
  }

  if (req.method === "GET" && pathname === "/api/mission-control/approvals") {
    sendJson(res, 200, { pending: [] });
    return;
  }

  if (req.method === "POST" && pathname === "/api/conversations") {
    const body = await readJson(req);
    const title = String(body.title ?? "New conversation");
    const id = safeThreadId(body.threadId);
    await ensureThreadRecord({
      threadId: id,
      sessionId: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
    });
    sendJson(res, 200, { id, threadId: id, title, name: title });
    return;
  }

  const conversationMessagesMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (conversationMessagesMatch) {
    const conversationId = decodeURIComponent(conversationMessagesMatch[1]);
    if (req.method === "GET") {
      const thread = await readThread(conversationId);
      sendJson(res, 200, { messages: thread.messages });
      return;
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      sendJson(res, 200, await startChatRun({ ...body, conversationId }));
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    const body = await readJson(req);
    sendJson(res, 200, await startChatRun(body));
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const threadId = safeThreadId(url.searchParams.get("threadId"));
    res.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
    const runId = url.searchParams.get("runId") ?? undefined;
    const cleanup = await addEventClient(threadId, res, runId);
    req.on("close", cleanup);
    return;
  }

  const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (req.method === "GET" && threadMatch) {
    sendJson(res, 200, await readThread(decodeURIComponent(threadMatch[1])));
    return;
  }

  const stopMatch = pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    const runId = decodeURIComponent(stopMatch[1]);
    const stopped = stopRun(runId);
    sendJson(res, stopped ? 200 : 404, { ok: stopped, runId });
    return;
  }

  sendJson(res, 404, { error: `Not found: ${pathname}` });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message, detail: message });
  });
});

server.listen(port, host, () => {
  console.log(`Pando dev API listening on http://${host}:${port}`);
  console.log(`Workspace: ${workspaceRoot}`);
});
