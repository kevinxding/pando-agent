import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LocalThreadStore } from '../src/services/threadStore/index.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..', '..');
const workspaceRoot = await mkdtemp(join(tmpdir(), 'pando-thread-goal-smoke-'));
const port = 43000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

try {
  const store = new LocalThreadStore(workspaceRoot);
  const threadId = 'thread_goal_smoke';
  await store.createThread({ threadId, sessionId: 'goal-smoke', title: 'Goal smoke', cwd: workspaceRoot });
  await store.appendMessage(threadId, {
    id: 'msg_user_real',
    role: 'user',
    content: 'real user message',
    createdAtMs: Date.now(),
  });
  const created = await store.setThreadGoal(threadId, { objective: 'Verify thread goal smoke' });
  assert.equal(created.status, 'active');

  server = spawn(process.execPath, ['backend/src/server/index.js', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: { ...process.env, PANDO_WORKSPACE_ROOT: workspaceRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();

  const active = await requestJson(`/api/goals/active?threadId=${threadId}`);
  assert.equal(active.goal.goalId, created.goalId);

  const missingThread = await requestJson(`/api/goals/${created.goalId}/pause`, { method: 'POST', body: {} });
  assert.equal(missingThread.status, 400);
  assert.match(missingThread.body.error, /Pass threadId/);

  const paused = await requestJson(`/api/goals/${created.goalId}/pause`, { method: 'POST', body: { threadId } });
  assert.equal(paused.goal.status, 'paused');

  const continuePaused = await requestJson(`/api/goals/${created.goalId}/continue`, { method: 'POST', body: { threadId } });
  assert.equal(continuePaused.status, 409);

  const resumed = await requestJson(`/api/goals/${created.goalId}/resume`, { method: 'POST', body: { threadId } });
  assert.equal(resumed.goal.status, 'active');

  const completed = await requestJson(`/api/goals/${created.goalId}/complete`, { method: 'POST', body: { threadId } });
  assert.equal(completed.goal.status, 'complete');

  const messages = await store.readMessages(threadId);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'real user message');

  const cleared = await store.clearThreadGoal(threadId);
  assert.equal(cleared.goalId, created.goalId);
  assert.equal(await store.readThreadGoal(threadId), undefined);
  console.log('thread goal smoke passed');
} finally {
  if (server && !server.killed) server.kill();
  await rm(workspaceRoot, { recursive: true, force: true });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not become healthy');
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  return response.ok ? body : { status: response.status, body };
}
