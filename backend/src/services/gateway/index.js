import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const GATEWAY_DIR = '.pandoshare/gateway';
const STATUS_FILE = 'status.json';
const RUNS_FILE = 'runs.jsonl';

export class LocalGatewayStore {
  workspaceRoot;
  root;

  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.root = join(workspaceRoot, GATEWAY_DIR);
  }

  async readStatus() {
    await mkdir(this.root, { recursive: true });
    try {
      const text = await readFile(join(this.root, STATUS_FILE), 'utf8');
      const parsed = JSON.parse(text);
      return normalizeStatus(parsed);
    } catch {
      return normalizeStatus({});
    }
  }

  async updateStatus(patch) {
    const current = await this.readStatus();
    const next = normalizeStatus({
      ...current,
      ...patch,
      updatedAtMs: Date.now(),
    });
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, STATUS_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  async appendRun(input) {
    const now = input.startedAtMs ?? Date.now();
    const run = {
      id: input.id ?? `gateway_run_${now}_${shortId()}`,
      runId: input.runId ?? input.id ?? `gateway_run_${now}_${shortId()}`,
      jobId: input.jobId,
      createdAtMs: input.createdAtMs ?? now,
      startedAtMs: now,
      finishedAtMs: input.finishedAtMs ?? Date.now(),
      durationMs: input.durationMs ?? 0,
      status: input.status ?? 'completed',
      summary: input.summary ?? 'Gateway run',
      message: input.message,
      channel: input.channel,
      target: input.target,
    };
    await mkdir(this.root, { recursive: true });
    await appendFile(join(this.root, RUNS_FILE), `${JSON.stringify(run)}\n`, 'utf8');
    return run;
  }

  async readRuns(limit = 50) {
    await mkdir(this.root, { recursive: true });
    try {
      const text = await readFile(join(this.root, RUNS_FILE), 'utf8');
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
        })
        .sort((left, right) => (right.startedAtMs ?? 0) - (left.startedAtMs ?? 0))
        .slice(0, limit);
    } catch {
      return [];
    }
  }
}

export function effectiveGatewayRunning(status) {
  return Boolean(status?.processAlive) && status?.running !== false;
}

function normalizeStatus(value) {
  return {
    running: value?.running !== false,
    processAlive: Boolean(value?.processAlive),
    pid: typeof value?.pid === 'number' ? value.pid : undefined,
    startedAtMs: typeof value?.startedAtMs === 'number' ? value.startedAtMs : undefined,
    lastHeartbeatAtMs: typeof value?.lastHeartbeatAtMs === 'number' ? value.lastHeartbeatAtMs : undefined,
    lastTickAtMs: typeof value?.lastTickAtMs === 'number' ? value.lastTickAtMs : undefined,
    processedSchedules: typeof value?.processedSchedules === 'number' ? value.processedSchedules : 0,
    processedTriggers: typeof value?.processedTriggers === 'number' ? value.processedTriggers : 0,
    processedMessages: typeof value?.processedMessages === 'number' ? value.processedMessages : 0,
    lastError: typeof value?.lastError === 'string' ? value.lastError : undefined,
    updatedAtMs: typeof value?.updatedAtMs === 'number' ? value.updatedAtMs : undefined,
  };
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}
