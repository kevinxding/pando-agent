import { spawn } from 'node:child_process';
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { defaultShellCommand, limitedText, toPortablePath } from '../tools/shared/index.js';
const activeChildren = new Map();
const outputWrites = new Map();
export class LocalTaskStore {
    workspaceRoot;
    root;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.root = join(workspaceRoot, '.pandoshare', 'tasks');
    }
    async createTask(input) {
        const now = Date.now();
        const taskId = sanitizeTaskId(input.taskId ?? `task_${now}_${shortId()}`);
        const taskDir = this.taskPath(taskId);
        await mkdir(taskDir, { recursive: true });
        const record = {
            taskId,
            title: input.title?.trim() || input.command?.slice(0, 80) || taskId,
            status: input.command ? 'running' : 'queued',
            cwd: resolve(input.cwd),
            command: input.command,
            createdAtMs: now,
            updatedAtMs: now,
            startedAtMs: input.command ? now : undefined,
            goalId: optionalAscii(input.goalId),
            threadId: optionalAscii(input.threadId),
            loopId: optionalAscii(input.loopId),
            outputPath: toPortablePath(join('.pandoshare', 'tasks', taskId, 'output.log')),
            outputChars: 0,
        };
        await this.writeTask(record);
        await writeFile(this.outputFile(taskId), '', 'utf8');
        if (input.command)
            this.startProcess(record);
        return record;
    }
    async listTasks() {
        await mkdir(this.root, { recursive: true });
        const entries = await readdir(this.root);
        const records = [];
        for (const entry of entries) {
            if (!(await safeIsDirectory(join(this.root, entry))))
                continue;
            try {
                records.push(await this.readTask(entry));
            }
            catch {
                // Ignore partial task folders left by interrupted runs.
            }
        }
        return records.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    }
    async readTask(taskId) {
        const text = await readFile(this.metadataFile(taskId), 'utf8');
        return JSON.parse(text);
    }
    async updateTask(taskId, input) {
        const record = await this.readTask(taskId);
        const next = {
            ...record,
            ...(input.status ? { status: input.status } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
            updatedAtMs: Date.now(),
        };
        if ((input.status === 'completed' || input.status === 'failed' || input.status === 'stopped') && !next.completedAtMs) {
            next.completedAtMs = Date.now();
        }
        await this.writeTask(next);
        return next;
    }
    async readOutput(taskId, maxChars = 20_000) {
        const text = await readFile(this.outputFile(taskId), 'utf8');
        return limitedText(text, maxChars);
    }
    async stopTask(taskId, reason = 'Task stopped.') {
        const child = activeChildren.get(sanitizeTaskId(taskId));
        if (child) {
            child.kill('SIGTERM');
            activeChildren.delete(taskId);
        }
        await this.queueAppendOutput(taskId, `\n[stopped] ${reason}\n`);
        return this.updateTask(taskId, { status: 'stopped', summary: reason });
    }
    taskPath(taskId) {
        return join(this.root, sanitizeTaskId(taskId));
    }
    metadataFile(taskId) {
        return join(this.taskPath(taskId), 'metadata.json');
    }
    outputFile(taskId) {
        return join(this.taskPath(taskId), 'output.log');
    }
    async writeTask(record) {
        await mkdir(dirname(this.metadataFile(record.taskId)), { recursive: true });
        await writeFile(this.metadataFile(record.taskId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    }
    async appendOutput(taskId, text) {
        await appendFile(this.outputFile(taskId), text, 'utf8');
        const record = await this.readTask(taskId);
        await this.writeTask({
            ...record,
            outputChars: record.outputChars + text.length,
            updatedAtMs: Date.now(),
        });
    }
    queueAppendOutput(taskId, text) {
        const previous = outputWrites.get(taskId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => this.appendOutput(taskId, text));
        outputWrites.set(taskId, next);
        return next;
    }
    startProcess(record) {
        const shell = defaultShellCommand(record.command ?? '');
        const child = spawn(shell.command, shell.args, {
            cwd: record.cwd,
            windowsHide: true,
            env: runtimeEnv(),
        });
        activeChildren.set(record.taskId, child);
        child.stdout?.on('data', chunk => {
            void this.queueAppendOutput(record.taskId, String(chunk));
        });
        child.stderr?.on('data', chunk => {
            void this.queueAppendOutput(record.taskId, String(chunk));
        });
        child.on('error', error => {
            activeChildren.delete(record.taskId);
            void this.queueAppendOutput(record.taskId, `\n[error] ${error.message}\n`);
            void this.updateTask(record.taskId, { status: 'failed', summary: error.message });
        });
        child.on('close', (exitCode, signal) => {
            activeChildren.delete(record.taskId);
            void this.finalizeTask(record.taskId, exitCode, signal);
        });
    }
    async finalizeTask(taskId, exitCode, signal) {
        await outputWrites.get(taskId);
        outputWrites.delete(taskId);
        const record = await this.readTask(taskId);
        if (record.status === 'stopped')
            return;
        const status = exitCode === 0 ? 'completed' : 'failed';
        await this.writeTask({
            ...record,
            status,
            exitCode,
            signal,
            completedAtMs: Date.now(),
            updatedAtMs: Date.now(),
            summary: status === 'completed' ? 'Task completed.' : `Task failed with exit code ${exitCode ?? 'null'}.`,
        });
    }
}
function sanitizeTaskId(taskId) {
    if (!/^[A-Za-z0-9_-]+$/.test(taskId))
        throw new Error(`Invalid taskId: ${taskId}`);
    return taskId;
}
function optionalAscii(value) {
    if (!value)
        return undefined;
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(`Invalid id: ${value}`);
    return value;
}
function shortId() {
    return Math.random().toString(36).slice(2, 8);
}
async function safeIsDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    }
    catch {
        return false;
    }
}
function runtimeEnv() {
    const runtime = globalThis;
    return runtime.process?.env ?? {};
}
