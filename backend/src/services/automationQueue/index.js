import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const AUTOMATION_DIR = '.pandoshare/automation';
const SCHEDULES_FILE = 'schedules.jsonl';
const TRIGGERS_FILE = 'triggers.jsonl';
const MESSAGES_FILE = 'messages.jsonl';

export class LocalAutomationQueue {
  workspaceRoot;
  root;

  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.root = join(workspaceRoot, AUTOMATION_DIR);
  }

  async createSchedule(input) {
    const now = Date.now();
    const schedule = {
      scheduleId: sanitizeId(input.scheduleId ?? `schedule_${now}_${shortId()}`, 'scheduleId'),
      schedule: requiredText(input.schedule, 'schedule'),
      command: normalizeGatewayCommand(requiredText(input.command, 'command')),
      title: optionalText(input.title),
      summary: optionalText(input.summary),
      target: optionalText(input.target),
      actionType: optionalText(input.actionType),
      retryCount: optionalPositiveInteger(input.retryCount),
      retryIntervalMinutes: optionalPositiveInteger(input.retryIntervalMinutes),
      status: 'scheduled',
      createdAtMs: now,
      updatedAtMs: now,
      nextRunAtMs: nextRunAtMs(input.schedule, now),
      runCount: 0,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
      loopId: optionalId(input.loopId),
    };
    await this.append(SCHEDULES_FILE, schedule);
    return schedule;
  }

  async createTrigger(input) {
    const now = Date.now();
    const trigger = {
      triggerId: sanitizeId(input.triggerId ?? `trigger_${now}_${shortId()}`, 'triggerId'),
      channel: requiredText(input.channel, 'channel'),
      payload: normalizeGatewayCommand(requiredText(input.payload, 'payload')),
      status: 'queued',
      createdAtMs: now,
      updatedAtMs: now,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
    };
    await this.append(TRIGGERS_FILE, trigger);
    return trigger;
  }

  async createMessage(input) {
    const now = Date.now();
    const message = {
      messageId: sanitizeId(input.messageId ?? `message_${now}_${shortId()}`, 'messageId'),
      channel: requiredText(input.channel, 'channel'),
      recipient: input.recipient?.trim() || 'default',
      text: requiredText(input.text, 'text'),
      status: 'queued',
      createdAtMs: now,
      updatedAtMs: now,
      goalId: optionalId(input.goalId),
      taskId: optionalId(input.taskId),
    };
    await this.append(MESSAGES_FILE, message);
    return message;
  }

  async dueSchedules(now = Date.now()) {
    const schedules = await this.readSchedules();
    return schedules.filter((schedule) => schedule.status === 'scheduled' && schedule.nextRunAtMs <= now);
  }

  async queuedTriggers() {
    return (await this.readTriggers()).filter((trigger) => trigger.status === 'queued');
  }

  async queuedMessages() {
    return (await this.readMessages()).filter((message) => message.status === 'queued');
  }

  async readSchedule(scheduleId) {
    return (await this.readSchedules()).find((schedule) => schedule.scheduleId === scheduleId);
  }

  async markScheduleRun(scheduleId, now = Date.now()) {
    const schedules = await this.readSchedules();
    const index = schedules.findIndex((schedule) => schedule.scheduleId === scheduleId);
    if (index === -1) throw new Error(`Schedule not found: ${scheduleId}`);
    const current = schedules[index];
    const oneShot = isOneShotSchedule(current.schedule);
    const next = {
      ...current,
      status: oneShot ? 'processed' : current.status,
      lastRunAtMs: now,
      updatedAtMs: now,
      nextRunAtMs: oneShot ? Number.MAX_SAFE_INTEGER : nextRunAtMs(current.schedule, now),
      runCount: current.runCount + 1,
    };
    schedules[index] = next;
    await this.write(SCHEDULES_FILE, schedules);
    return next;
  }

  async setSchedulePaused(scheduleId, paused) {
    const schedules = await this.readSchedules();
    const index = schedules.findIndex((schedule) => schedule.scheduleId === scheduleId);
    if (index === -1) throw new Error(`Schedule not found: ${scheduleId}`);
    const current = schedules[index];
    const now = Date.now();
    const next = {
      ...current,
      status: paused ? 'paused' : 'scheduled',
      updatedAtMs: now,
      nextRunAtMs: paused ? current.nextRunAtMs : nextRunAtMs(current.schedule, now),
    };
    schedules[index] = next;
    await this.write(SCHEDULES_FILE, schedules);
    return next;
  }

  async deleteSchedule(scheduleId) {
    const schedules = await this.readSchedules();
    const nextSchedules = schedules.filter((schedule) => schedule.scheduleId !== scheduleId);
    if (nextSchedules.length === schedules.length) return false;
    await this.write(SCHEDULES_FILE, nextSchedules);
    return true;
  }

  async markTriggerProcessed(triggerId, status = 'processed') {
    const triggers = await this.readTriggers();
    const index = triggers.findIndex((trigger) => trigger.triggerId === triggerId);
    if (index === -1) throw new Error(`Trigger not found: ${triggerId}`);
    const now = Date.now();
    const next = {
      ...triggers[index],
      status,
      processedAtMs: now,
      updatedAtMs: now,
    };
    triggers[index] = next;
    await this.write(TRIGGERS_FILE, triggers);
    return next;
  }

  async markMessageSent(messageId, status = 'sent') {
    const messages = await this.readMessages();
    const index = messages.findIndex((message) => message.messageId === messageId);
    if (index === -1) throw new Error(`Message not found: ${messageId}`);
    const now = Date.now();
    const next = {
      ...messages[index],
      status,
      sentAtMs: now,
      updatedAtMs: now,
    };
    messages[index] = next;
    await this.write(MESSAGES_FILE, messages);
    return next;
  }

  async readSnapshot(limit = 50) {
    const [schedules, triggers, messages] = await Promise.all([
      this.readSchedules(),
      this.readTriggers(),
      this.readMessages(),
    ]);
    return {
      schedules: schedules.sort(sortByUpdated).slice(0, limit),
      triggers: triggers.sort(sortByUpdated).slice(0, limit),
      messages: messages.sort(sortByUpdated).slice(0, limit),
    };
  }

  readSchedules() {
    return this.read(SCHEDULES_FILE);
  }

  readTriggers() {
    return this.read(TRIGGERS_FILE);
  }

  readMessages() {
    return this.read(MESSAGES_FILE);
  }

  async append(filename, record) {
    await mkdir(this.root, { recursive: true });
    await appendFile(join(this.root, filename), `${JSON.stringify(record)}\n`, 'utf8');
  }

  async read(filename) {
    await mkdir(this.root, { recursive: true });
    try {
      const text = await readFile(join(this.root, filename), 'utf8');
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  async write(filename, records) {
    await mkdir(this.root, { recursive: true });
    await writeFile(
      join(this.root, filename),
      records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
      'utf8',
    );
  }
}

export function normalizeGatewayCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('command must be a non-empty string');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function nextRunAtMs(schedule, now) {
  const trimmed = schedule.trim();
  if (isOneShotSchedule(trimmed)) return now;
  const everyMatch = /^@every\s+(\d+)(ms|s|m|h)$/.exec(trimmed);
  if (everyMatch) return now + durationMs(Number(everyMatch[1]), everyMatch[2]);
  const minuteMatch = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(trimmed);
  if (minuteMatch) return now + durationMs(Number(minuteMatch[1]), 'm');
  throw new Error('schedule must be @once, @now, @every <n>ms|s|m|h, or */N * * * *');
}

function isOneShotSchedule(schedule) {
  const trimmed = schedule.trim();
  return trimmed === '@once' || trimmed === '@now';
}

function durationMs(value, unit) {
  if (!Number.isInteger(value) || value <= 0) throw new Error('schedule interval must be a positive integer');
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60_000;
  if (unit === 'h') return value * 3_600_000;
  throw new Error(`Unsupported schedule unit: ${unit}`);
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw new Error(`Invalid integer value: ${value}`);
  return numeric;
}

function optionalId(value) {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid id: ${value}`);
  return value;
}

function sanitizeId(value, name) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${name}: ${value}`);
  return value;
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

function sortByUpdated(a, b) {
  return b.updatedAtMs - a.updatedAtMs;
}
