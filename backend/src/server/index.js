import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QueryEngine } from "../QueryEngine.js";
import { loadProjectConfig, resolveDefaultModel } from "../services/config/index.js";
import { generateText } from "../services/llm/client.js";
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
const pendingApprovals = new Map();
const alwaysApprovedToolKeys = new Set();

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
function approvalAlwaysKey(threadId, toolName) {
  return `${threadId}:${toolName ?? "tool"}`;
}

function approvalIdFor(request) {
  return String(
    request.approvalId ??
      request.toolUse?.id ??
      `approval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );
}

function approvalRequestSummary(record) {
  const request = record.request;
  return {
    approvalId: record.approvalId,
    threadId: record.threadId,
    runId: record.runId,
    toolUseId: request.toolUse?.id,
    toolName: request.toolName,
    safety: request.safety,
    approvalPolicy: request.approvalPolicy,
    approvalsReviewer: request.approvalsReviewer,
    sandboxMode: request.sandboxMode,
    risk: request.risk,
    reason: request.reason,
    input: request.toolUse?.input,
    createdAtMs: record.createdAtMs,
  };
}

function pendingApprovalToJson(record) {
  const request = approvalRequestSummary(record);
  return {
    ...request,
    id: record.approvalId,
    status: record.status,
    request,
  };
}

function approvalEvent(type, record, extra = {}) {
  const request = approvalRequestSummary(record);
  return {
    type,
    id: `${type}_${record.approvalId}_${Date.now()}`,
    approvalId: record.approvalId,
    threadId: record.threadId,
    runId: record.runId,
    createdAtMs: Date.now(),
    toolUseId: request.toolUseId,
    toolName: request.toolName,
    safety: request.safety,
    approvalPolicy: request.approvalPolicy,
    approvalsReviewer: request.approvalsReviewer,
    sandboxMode: request.sandboxMode,
    risk: request.risk,
    reason: request.reason,
    request,
    ...extra,
  };
}

function normalizeApprovalDecisionValue(value) {
  if (value === "approve_once" || value === "approve_always" || value === "reject") {
    return value;
  }
  return "reject";
}

function waitForToolApproval({ threadId, getRunId, request }) {
  const approvalId = approvalIdFor(request);
  const normalizedRequest = { ...request, approvalId };
  const alwaysKey = approvalAlwaysKey(threadId, normalizedRequest.toolName);

  if (alwaysApprovedToolKeys.has(alwaysKey)) {
    return {
      approved: true,
      reason: `Approved ${normalizedRequest.toolName} by this session approval rule.`,
    };
  }

  return new Promise((resolve) => {
    const record = {
      approvalId,
      threadId,
      runId: getRunId(),
      request: normalizedRequest,
      resolve,
      status: "pending",
      createdAtMs: Date.now(),
    };
    pendingApprovals.set(approvalId, record);
    broadcast(threadId, approvalEvent("approval_pending", record));
  });
}

function answerApproval(approvalId, rawDecision) {
  const decision = normalizeApprovalDecisionValue(rawDecision);
  const record = pendingApprovals.get(approvalId);

  if (!record) {
    return undefined;
  }

  pendingApprovals.delete(approvalId);
  record.status = decision === "reject" ? "rejected" : "approved";

  if (decision === "approve_always") {
    alwaysApprovedToolKeys.add(approvalAlwaysKey(record.threadId, record.request.toolName));
  }

  const approved = decision !== "reject";
  const reason = approved
    ? decision === "approve_always"
      ? `Approved ${record.request.toolName} for this session.`
      : `Approved ${record.request.toolName} once.`
    : `Rejected ${record.request.toolName}.`;

  record.resolve({ approved, reason });
  broadcast(
    record.threadId,
    approvalEvent("approval_answered", record, {
      decision,
      approved,
      reason,
    }),
  );

  return { ok: true, approvalId, decision, approved };
}

function clearRunApprovals(runId, reason = "Run ended before approval was answered.") {
  for (const [approvalId, record] of [...pendingApprovals.entries()]) {
    if (record.runId !== runId) continue;
    pendingApprovals.delete(approvalId);
    record.status = "rejected";
    record.resolve({ approved: false, reason });
    broadcast(
      record.threadId,
      approvalEvent("approval_answered", record, {
        decision: "reject",
        approved: false,
        reason,
      }),
    );
  }
}

const TITLE_GENERATOR_SYSTEM = [
  "You are a title generator. Output only a short conversation title.",
  "Rules:",
  "- Use the same language as the user's message.",
  "- Output a single line, no markdown, no quotes, no explanation.",
  "- Keep it under 60 characters.",
  "- Do not mention tools or implementation details.",
  "- If the input is short, still produce a useful title like Greeting, Quick check-in, or a natural equivalent.",
].join("\n");

function temporaryTitleFromPrompt(prompt) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "New conversation";
  return normalized.length > 40 ? `${normalized.slice(0, 37)}...` : normalized;
}

function defaultOrAutoTitle(metadata) {
  if (metadata.titleSource === "manual") return false;
  if (metadata.titleSource === "temporary" || metadata.titleSource === "generated") return true;
  const title = String(metadata.title ?? "").trim();
  return (
    !title ||
    title === "New conversation" ||
    title.startsWith("New conversation") ||
    title.startsWith("\u65b0\u5bf9\u8bdd") ||
    title.startsWith("\u65b0\u4f1a\u8bdd") ||
    title.startsWith("thread_") ||
    /^New session - \d{4}-\d{2}-\d{2}T/.test(title)
  );
}

async function updateThreadTitleIfAllowed(store, threadId, input) {
  const metadata = await store.readMetadata(threadId);
  if (!defaultOrAutoTitle(metadata)) return undefined;

  const title = normalizeGeneratedTitle(input.title, input.fallbackTitle);
  if (!title) return undefined;

  const nextMetadata = {
    ...metadata,
    title,
    titleSource: input.titleSource,
    titleUpdatedAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  await store.writeMetadata(nextMetadata);

  const event = {
    type: "thread_title_updated",
    id: `thread_title_updated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    sessionId: nextMetadata.sessionId,
    createdAtMs: Date.now(),
    title,
    titleSource: input.titleSource,
  };
  await store.appendEvent(threadId, event).catch(() => undefined);
  broadcast(threadId, event);
  return nextMetadata;
}

function normalizeGeneratedTitle(title, fallbackTitle) {
  const firstLine = String(title ?? "")
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .split(/\r?\n|\r/)
    .map((line) => line.trim().replace(/^['\"“”‘’`]+|['\"“”‘’`]+$/g, ""))
    .find((line) => line.length > 0);
  const candidate = firstLine || fallbackTitle;
  if (!candidate) return undefined;
  return candidate.length > 100 ? `${candidate.slice(0, 97)}...` : candidate;
}

async function maybeAutoTitleThread(input) {
  const { store, threadId, prompt, config } = input;
  const messages = await store.readMessages(threadId).catch(() => []);
  const userMessageCount = messages.filter((message) => message.role === "user").length;
  if (userMessageCount > 0) return;

  const fallbackTitle = temporaryTitleFromPrompt(prompt);
  await updateThreadTitleIfAllowed(store, threadId, {
    title: fallbackTitle,
    fallbackTitle,
    titleSource: "temporary",
  });

  void generateThreadTitle({ store, threadId, prompt, config, fallbackTitle });
}

async function generateThreadTitle(input) {
  try {
    const model = resolveDefaultModel(input.config ?? {});
    const response = await generateText(
      {
        model,
        system: TITLE_GENERATOR_SYSTEM,
        prompt: `Generate a title for this conversation:\n\n${input.prompt}`,
        temperature: 0,
        maxTokens: 80,
      },
      { retry: false },
    );
    await updateThreadTitleIfAllowed(input.store, input.threadId, {
      title: response.text,
      fallbackTitle: input.fallbackTitle,
      titleSource: "generated",
    });
  } catch {
    // Keep the temporary title if generation fails.
  }
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
      titleSource: input.titleSource,
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
    title: temporaryTitleFromPrompt(prompt),
    titleSource: "temporary",
    permissions: config.permissions,
  });
  const titleStore = new LocalThreadStore(workspaceRoot);
  await maybeAutoTitleThread({ store: titleStore, threadId, prompt, config });

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
    requestToolApproval: (request) =>
      waitForToolApproval({
        threadId,
        getRunId: () => runId,
        request,
      }),
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
      if (runId) {
        clearRunApprovals(runId);
        activeRuns.delete(runId);
      }
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
  clearRunApprovals(runId, "Stopped by user.");
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
    sendJson(res, 200, { pending: [...pendingApprovals.values()].map(pendingApprovalToJson) });
    return;
  }

  const approvalMatch = pathname.match(/^\/api\/approval\/([^/]+)$/);
  if (req.method === "POST" && approvalMatch) {
    const body = await readJson(req);
    const approvalId = decodeURIComponent(approvalMatch[1]);
    const result = answerApproval(approvalId, body.decision);
    sendJson(
      res,
      result ? 200 : 404,
      result ?? { ok: false, approvalId, error: "Approval request is no longer pending." },
    );
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
      titleSource: "placeholder",
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
