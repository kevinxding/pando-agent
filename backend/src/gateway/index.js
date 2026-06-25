import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableRuntime } from '../core/durable/index.js';
import { loadProjectConfig } from '../services/config/index.js';
import { LocalAutomationQueue } from '../services/automationQueue/index.js';
import { LocalGatewayStore } from '../services/gateway/index.js';

const gatewaySrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.resolve(gatewaySrcRoot, '..');
const defaultWorkspaceRoot = path.resolve(backendRoot, '..');
const workspaceRoot = process.env.PANDO_WORKSPACE_ROOT?.trim()
  ? path.resolve(process.env.PANDO_WORKSPACE_ROOT)
  : defaultWorkspaceRoot;
const runtimeDataRoot = path.join(workspaceRoot, '.pandoshare');
const workspaceId = 'pando-agent';
const workerId = 'gateway_local';
const gatewayId = 'local_gateway';

const queue = new LocalAutomationQueue(workspaceRoot);
const gatewayStore = new LocalGatewayStore(workspaceRoot);
const durable = new DurableRuntime({ workspaceRoot, workspaceId });

let intervalHandle;
let shuttingDown = false;
let heartbeatIntervalMs = 5000;

async function readFileIfExists(filePath) {
  try {
    const fs = await import('node:fs/promises');
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function loadGatewayConfig() {
  const projectConfig = await loadProjectConfig(workspaceRoot, readFileIfExists);
  const gateway = projectConfig?.config?.gateway ?? {};
  return {
    enabled: gateway.enabled !== false,
    heartbeatIntervalMs:
      typeof gateway.heartbeatIntervalMs === 'number' && gateway.heartbeatIntervalMs > 0
        ? gateway.heartbeatIntervalMs
        : 5000,
  };
}

async function appendGatewayEvent(eventType, payload) {
  await durable.appendEvent({
    eventType,
    workspaceId,
    payload: {
      gatewayId,
      workerId,
      ...payload,
    },
  });
}

async function writeGatewayHeartbeat(status, message, metadata) {
  await durable.writeHeartbeat({
    workspaceId,
    workerId,
    workerType: 'gateway',
    gatewayId,
    pid: process.pid,
    status,
    kernel: 'gateway',
    message,
    metadata,
  });
}

function scheduleSummary(schedule) {
  return schedule.summary ?? schedule.command ?? 'Scheduled gateway task';
}

function scheduleTarget(schedule) {
  return schedule.target ?? 'Pando Agent';
}

async function dispatchSchedule(schedule) {
  const actionType = String(schedule.actionType ?? 'system_event').trim();
  const target = scheduleTarget(schedule);
  const summary = scheduleSummary(schedule);

  if (actionType === 'gateway_message') {
    await queue.createMessage({
      channel: target,
      recipient: 'default',
      text: summary,
      taskId: schedule.scheduleId,
      goalId: schedule.goalId,
    });
    return `Queued gateway message to ${target}`;
  }

  if (actionType === 'remote_trigger' || actionType === 'loop_wake') {
    await queue.createTrigger({
      channel: target,
      payload: summary,
      taskId: schedule.scheduleId,
      goalId: schedule.goalId,
    });
    return `Queued ${actionType} for ${target}`;
  }

  return `Recorded ${actionType} for ${target}`;
}

async function processSchedule(schedule) {
  const startedAtMs = Date.now();
  const updated = await queue.markScheduleRun(schedule.scheduleId, startedAtMs);
  const summary = await dispatchSchedule(schedule);
  const run = await gatewayStore.appendRun({
    jobId: schedule.scheduleId,
    startedAtMs,
    finishedAtMs: Date.now(),
    durationMs: Date.now() - startedAtMs,
    status: 'completed',
    summary,
    target: scheduleTarget(schedule),
  });
  await appendGatewayEvent('gateway_command_completed', {
    scheduleId: schedule.scheduleId,
    runId: run.runId,
    summary,
    target: scheduleTarget(schedule),
    nextRunAtMs: updated.nextRunAtMs,
  });
  return 1;
}

async function processTrigger(trigger) {
  const startedAtMs = Date.now();
  await queue.markTriggerProcessed(trigger.triggerId, 'processed');
  const summary = `Processed trigger for ${trigger.channel}`;
  const run = await gatewayStore.appendRun({
    jobId: trigger.taskId ?? trigger.triggerId,
    startedAtMs,
    finishedAtMs: Date.now(),
    durationMs: Date.now() - startedAtMs,
    status: 'completed',
    summary,
    channel: trigger.channel,
    target: trigger.channel,
  });
  await appendGatewayEvent('gateway_trigger_completed', {
    triggerId: trigger.triggerId,
    runId: run.runId,
    channel: trigger.channel,
    summary,
  });
  return 1;
}

async function processMessage(message) {
  const startedAtMs = Date.now();
  await queue.markMessageSent(message.messageId, 'sent');
  const summary = `Sent message to ${message.channel}`;
  const run = await gatewayStore.appendRun({
    jobId: message.taskId ?? message.messageId,
    startedAtMs,
    finishedAtMs: Date.now(),
    durationMs: Date.now() - startedAtMs,
    status: 'completed',
    summary,
    channel: message.channel,
    target: message.channel,
  });
  await appendGatewayEvent('gateway_outbound_sent', {
    messageId: message.messageId,
    runId: run.runId,
    channel: message.channel,
    recipient: message.recipient,
    summary,
  });
  return 1;
}

async function tick() {
  const status = await gatewayStore.readStatus();
  if (status.running === false) {
    const paused = await gatewayStore.updateStatus({
      processAlive: true,
      pid: process.pid,
      lastHeartbeatAtMs: Date.now(),
      lastTickAtMs: Date.now(),
      lastError: undefined,
    });
    await writeGatewayHeartbeat('paused', 'Gateway paused by status flag.', paused);
    return;
  }

  const [schedules, triggers, messages] = await Promise.all([
    queue.dueSchedules(),
    queue.queuedTriggers(),
    queue.queuedMessages(),
  ]);

  let processedSchedules = 0;
  let processedTriggers = 0;
  let processedMessages = 0;

  for (const schedule of schedules) {
    processedSchedules += await processSchedule(schedule);
  }

  for (const trigger of triggers) {
    processedTriggers += await processTrigger(trigger);
  }

  for (const message of messages) {
    processedMessages += await processMessage(message);
  }

  const nextStatus = await gatewayStore.updateStatus({
    running: true,
    processAlive: true,
    pid: process.pid,
    lastHeartbeatAtMs: Date.now(),
    lastTickAtMs: Date.now(),
    processedSchedules: status.processedSchedules + processedSchedules,
    processedTriggers: status.processedTriggers + processedTriggers,
    processedMessages: status.processedMessages + processedMessages,
    lastError: undefined,
  });

  await writeGatewayHeartbeat(
    'running',
    `Gateway tick completed: ${processedSchedules} schedule(s), ${processedTriggers} trigger(s), ${processedMessages} message(s).`,
    nextStatus,
  );
}

async function main() {
  const gatewayConfig = await loadGatewayConfig();
  heartbeatIntervalMs = gatewayConfig.heartbeatIntervalMs;
  const existingStatus = await gatewayStore.readStatus();
  const running = gatewayConfig.enabled ? existingStatus.running !== false : false;
  const startedAtMs = existingStatus.startedAtMs ?? Date.now();

  await gatewayStore.updateStatus({
    running,
    processAlive: true,
    pid: process.pid,
    startedAtMs,
    lastHeartbeatAtMs: Date.now(),
    lastTickAtMs: Date.now(),
    lastError: undefined,
  });

  console.log(`Pando Gateway starting in ${workspaceRoot}`);
  console.log(`Gateway runtime data: ${runtimeDataRoot}`);
  console.log(`Gateway processing: ${running ? 'enabled' : 'paused'}`);

  await appendGatewayEvent('gateway_started', {
    gatewayId,
    pid: process.pid,
    startedAtMs,
    running,
  });

  await tick();
  intervalHandle = setInterval(() => {
    void tick().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await gatewayStore.updateStatus({
        processAlive: true,
        pid: process.pid,
        lastHeartbeatAtMs: Date.now(),
        lastTickAtMs: Date.now(),
        lastError: message,
      });
      await appendGatewayEvent('gateway_command_failed', {
        gatewayId,
        pid: process.pid,
        message,
      });
      await writeGatewayHeartbeat('error', message, { gatewayId, pid: process.pid, lastError: message });
      console.error(`Gateway tick failed: ${message}`);
    });
  }, heartbeatIntervalMs);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (intervalHandle) clearInterval(intervalHandle);
  await gatewayStore.updateStatus({
    processAlive: false,
    pid: process.pid,
    lastHeartbeatAtMs: Date.now(),
    lastTickAtMs: Date.now(),
  });
  await appendGatewayEvent('gateway_stopped', {
    gatewayId,
    pid: process.pid,
    signal,
    stoppedAtMs: Date.now(),
  }).catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Gateway failed to start: ${message}`);
  await gatewayStore.updateStatus({
    processAlive: false,
    pid: process.pid,
    lastHeartbeatAtMs: Date.now(),
    lastTickAtMs: Date.now(),
    lastError: message,
  }).catch(() => undefined);
  process.exit(1);
});
