import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { previewText } from '../events/index.js';
const THREADS_DIR = '.pandoshare/threads';
const RUNS_DIR = '.pandoshare/runs';
const METADATA_FILE = 'metadata.json';
const EVENTS_FILE = 'events.jsonl';
const MESSAGES_FILE = 'messages.jsonl';
const CHECKPOINTS_FILE = 'checkpoints.jsonl';
const COMPACTIONS_FILE = 'compactions.jsonl';
const RUNS_FILE = 'runs.jsonl';
const GOAL_FILE = 'goal.json';
export class LocalThreadStore {
    workspaceRoot;
    root;
    runsRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.root = resolve(workspaceRoot, THREADS_DIR);
        this.runsRoot = resolve(workspaceRoot, RUNS_DIR);
    }
    async createThread(input) {
        const now = Date.now();
        const threadId = input.threadId ?? generateThreadId(now);
        const metadata = {
            threadId,
            sessionId: input.sessionId,
            title: input.title ?? defaultThreadTitle(threadId),
            titleSource: input.titleSource,
            titleUpdatedAtMs: input.titleSource ? now : undefined,
            cwd: resolve(input.cwd),
            createdAtMs: now,
            updatedAtMs: now,
            model: input.model,
            permissions: input.permissions,
            parentThreadId: input.parentThreadId,
            branchFromEventId: input.branchFromEventId,
            goalId: input.goalId,
        };
        await this.writeMetadata(metadata);
        await ensureThreadFiles(this.threadPath(threadId));
        return {
            metadata,
            path: this.threadPath(threadId),
        };
    }
    async openThread(threadId, sessionId) {
        const metadata = await this.readMetadata(threadId);
        const nextMetadata = sessionId ? { ...metadata, sessionId, updatedAtMs: Date.now() } : metadata;
        if (sessionId)
            await this.writeMetadata(nextMetadata);
        return {
            metadata: nextMetadata,
            path: this.threadPath(threadId),
        };
    }
    async openLastThread(sessionId) {
        const records = await this.listThreads();
        const last = records.sort((a, b) => b.metadata.updatedAtMs - a.metadata.updatedAtMs)[0];
        if (!last)
            return undefined;
        return sessionId ? this.openThread(last.metadata.threadId, sessionId) : last;
    }
    async listThreads() {
        await mkdir(this.root, { recursive: true });
        const entries = await readdir(this.root);
        const records = [];
        for (const entry of entries) {
            const path = this.threadPath(entry);
            if (!(await isDirectory(path)))
                continue;
            try {
                records.push({
                    metadata: await this.readMetadata(entry),
                    path,
                });
            }
            catch {
                // Ignore malformed thread folders so one corrupt session does not hide the rest.
            }
        }
        return records;
    }
    async listThreadSummaries(input = {}) {
        const records = await this.listThreads();
        const summaries = [];
        for (const record of records.sort((a, b) => b.metadata.updatedAtMs - a.metadata.updatedAtMs)) {
            summaries.push(await this.readThreadSummary(record.metadata.threadId));
            if (input.limit !== undefined && summaries.length >= input.limit)
                break;
        }
        return summaries;
    }
    async readThreadSummary(threadId) {
        const metadata = await this.readMetadata(threadId);
        const messages = await this.readMessages(threadId);
        const events = await this.readEvents(threadId);
        const checkpoints = await this.readCheckpoints(threadId);
        const compactions = await this.readCompactions(threadId);
        const goal = await this.readThreadGoal(threadId);
        return {
            metadata,
            messageCount: messages.length,
            eventCount: events.length,
            checkpointCount: checkpoints.length,
            compactionCount: compactions.length,
            lastCheckpoint: checkpoints[checkpoints.length - 1],
            latestCompaction: latestSuccessfulCompaction(compactions),
            goal,
        };
    }
    async renameThread(threadId, title) {
        const trimmed = title.trim();
        if (!trimmed)
            throw new Error('Thread title must not be empty');
        const metadata = await this.readMetadata(threadId);
        const nextMetadata = {
            ...metadata,
            title: trimmed,
            titleSource: 'manual',
            titleUpdatedAtMs: Date.now(),
            updatedAtMs: Date.now(),
        };
        await this.writeMetadata(nextMetadata);
        return nextMetadata;
    }
    async branchThread(threadId, input = { sessionId: 'thread-branch' }) {
        const parent = await this.readMetadata(threadId);
        const messages = await this.readMessages(threadId);
        const branch = await this.createThread({
            sessionId: input.sessionId,
            title: input.title ?? `Branch of ${parent.title}`,
            cwd: parent.cwd,
            model: parent.model,
            permissions: parent.permissions,
            parentThreadId: parent.threadId,
            goalId: parent.goalId,
        });
        await this.writeMessages(branch.metadata.threadId, messages);
        return {
            ...branch,
            metadata: await this.readMetadata(branch.metadata.threadId),
        };
    }
    async exportThread(threadId, format = 'md') {
        const data = redactExportData(await this.readThreadExport(threadId));
        switch (format) {
            case 'json':
                return `${JSON.stringify(data, null, 2)}\n`;
            case 'md':
                return formatThreadExportMarkdown(data);
        }
    }
    async readThreadExport(threadId) {
        return {
            metadata: await this.readMetadata(threadId),
            goal: await this.readThreadGoal(threadId),
            messages: await this.readMessages(threadId),
            events: await this.readEvents(threadId),
            checkpoints: await this.readCheckpoints(threadId),
            compactions: await this.readCompactions(threadId),
        };
    }
    async readThreadGoal(threadId) {
        const filePath = this.filePath(threadId, GOAL_FILE);
        if (!(await exists(filePath)))
            return undefined;
        return normalizeThreadGoal(JSON.parse(await readFile(filePath, 'utf8')), threadId);
    }
    async setThreadGoal(threadId, input = {}) {
        const metadata = await this.readMetadata(threadId);
        const existing = await this.readThreadGoal(threadId);
        const nowMs = Date.now();
        const nowSeconds = Math.floor(nowMs / 1000);
        const objective = typeof input.objective === 'string' && input.objective.trim()
            ? input.objective.trim()
            : existing?.objective;
        if (!objective)
            throw new Error('Goal objective must not be empty');
        const rawTokenBudget = input.tokenBudget ?? existing?.tokenBudget;
        const tokenBudget = rawTokenBudget === undefined || rawTokenBudget === null
            ? undefined
            : Math.max(0, Math.floor(Number(rawTokenBudget)));
        const tokensUsed = Math.max(0, Math.floor(Number(input.tokensUsed ?? existing?.tokensUsed ?? 0)));
        const timeUsedSeconds = Math.max(0, Math.floor(Number(input.timeUsedSeconds ?? existing?.timeUsedSeconds ?? 0)));
        const requestedStatus = normalizeGoalStatus(input.status ?? existing?.status ?? 'active');
        const status = requestedStatus === 'active' && tokenBudget !== undefined && tokensUsed >= tokenBudget
            ? 'budgetLimited'
            : requestedStatus;
        const goal = {
            goalId: existing?.goalId ?? `goal_${nowMs}_${shortId()}`,
            threadId,
            objective,
            status,
            tokenBudget,
            tokensUsed,
            timeUsedSeconds,
            createdAt: existing?.createdAt ?? nowSeconds,
            updatedAt: nowSeconds,
        };
        await writeJsonFile(this.filePath(threadId, GOAL_FILE), goal);
        await this.writeMetadata({
            ...metadata,
            goalId: goal.goalId,
            updatedAtMs: nowMs,
        });
        return goal;
    }
    async clearThreadGoal(threadId) {
        const metadata = await this.readMetadata(threadId);
        const existing = await this.readThreadGoal(threadId);
        if (!existing)
            return undefined;
        await rm(this.filePath(threadId, GOAL_FILE), { force: true });
        await this.writeMetadata({
            ...metadata,
            goalId: undefined,
            updatedAtMs: Date.now(),
        });
        return existing;
    }
    async accountThreadGoalUsage(threadId, input = {}) {
        const existing = await this.readThreadGoal(threadId);
        if (!existing || existing.status !== 'active')
            return existing;
        const tokenDelta = Math.max(0, Math.floor(Number(input.tokenDelta ?? 0)));
        const timeDeltaSeconds = Math.max(0, Math.floor(Number(input.timeDeltaSeconds ?? 0)));
        if (tokenDelta === 0 && timeDeltaSeconds === 0)
            return existing;
        return this.setThreadGoal(threadId, {
            ...existing,
            tokensUsed: existing.tokensUsed + tokenDelta,
            timeUsedSeconds: existing.timeUsedSeconds + timeDeltaSeconds,
        });
    }
    async appendEvent(threadId, event) {
        await appendJsonLine(this.filePath(threadId, EVENTS_FILE), event);
        await this.touch(threadId);
    }
    async appendMessage(threadId, message) {
        await appendJsonLine(this.filePath(threadId, MESSAGES_FILE), message);
        await this.touch(threadId);
    }
    async writeMessages(threadId, messages) {
        await writeJsonLines(this.filePath(threadId, MESSAGES_FILE), messages);
        await this.touch(threadId);
    }
    async readMessages(threadId) {
        return readJsonLines(this.filePath(threadId, MESSAGES_FILE));
    }
    async readEvents(threadId) {
        return readJsonLines(this.filePath(threadId, EVENTS_FILE));
    }
    async appendCheckpoint(threadId, checkpoint) {
        await appendJsonLine(this.filePath(threadId, CHECKPOINTS_FILE), checkpoint);
        await this.touch(threadId);
    }
    async readCheckpoints(threadId) {
        return readJsonLines(this.filePath(threadId, CHECKPOINTS_FILE));
    }
    async appendCompaction(threadId, compaction) {
        await appendJsonLine(this.filePath(threadId, COMPACTIONS_FILE), compaction);
        await this.touch(threadId);
    }
    async readCompactions(threadId) {
        return readJsonLines(this.filePath(threadId, COMPACTIONS_FILE));
    }
    async latestCompaction(threadId) {
        return latestSuccessfulCompaction(await this.readCompactions(threadId));
    }
    async appendRunLedger(entry) {
        await mkdir(this.runsRoot, { recursive: true });
        await appendJsonLine(join(this.runsRoot, RUNS_FILE), entry);
    }
    async readRunLedger(input = {}) {
        const entries = await readJsonLines(join(this.runsRoot, RUNS_FILE));
        const filtered = input.threadId
            ? entries.filter(entry => entry.threadId === input.threadId)
            : entries;
        const sorted = filtered.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
        return input.limit === undefined ? sorted : sorted.slice(0, input.limit);
    }
    async readStaleRuns(input = {}) {
        const nowMs = input.nowMs ?? Date.now();
        const staleAfterMs = input.staleAfterMs ?? 10 * 60_000;
        const latestByRunId = new Map();
        for (const entry of await this.readRunLedger()) {
            const existing = latestByRunId.get(entry.runId);
            if (!existing || entry.updatedAtMs >= existing.updatedAtMs) {
                latestByRunId.set(entry.runId, entry);
            }
        }
        const staleRuns = Array.from(latestByRunId.values())
            .filter(entry => entry.status === 'started')
            .map(entry => ({
            ...entry,
            ageMs: Math.max(0, nowMs - entry.updatedAtMs),
            staleAfterMs,
        }))
            .filter(entry => entry.ageMs > staleAfterMs)
            .sort((left, right) => right.ageMs - left.ageMs);
        return input.limit === undefined ? staleRuns : staleRuns.slice(0, input.limit);
    }
    async nextCompactionWindowId(threadId) {
        const compactions = await this.readCompactions(threadId);
        const maxWindowId = compactions.reduce((max, compaction) => Math.max(max, compaction.windowId), 0);
        return maxWindowId + 1;
    }
    async readMetadata(threadId) {
        return JSON.parse(await readFile(this.filePath(threadId, METADATA_FILE), 'utf8'));
    }
    async writeMetadata(metadata) {
        await mkdir(this.threadPath(metadata.threadId), { recursive: true });
        await writeJsonFile(this.filePath(metadata.threadId, METADATA_FILE), metadata);
    }
    createCheckpoint(input) {
        const now = Date.now();
        return {
            checkpointId: `checkpoint_${now}_${shortId()}`,
            threadId: input.metadata.threadId,
            goalId: input.metadata.goalId,
            sessionId: input.metadata.sessionId,
            turnId: input.turnId,
            createdAtMs: now,
            messageCount: input.messageCount,
            eventCount: input.eventCount,
            finalTextPreview: previewText(input.finalText, 500),
            context: input.context,
        };
    }
    threadPath(threadId) {
        return join(this.root, sanitizeThreadId(threadId));
    }
    filePath(threadId, filename) {
        return join(this.threadPath(threadId), filename);
    }
    async touch(threadId) {
        const metadata = await this.readMetadata(threadId);
        await this.writeMetadata({
            ...metadata,
            updatedAtMs: Date.now(),
        });
    }
}
function normalizeThreadGoal(value, fallbackThreadId) {
    const status = normalizeGoalStatus(value.status);
    return {
        goalId: typeof value.goalId === 'string' ? value.goalId : `goal_${Date.now()}_${shortId()}`,
        threadId: typeof value.threadId === 'string' ? value.threadId : fallbackThreadId,
        objective: typeof value.objective === 'string' ? value.objective : '',
        status,
        tokenBudget: value.tokenBudget === undefined || value.tokenBudget === null ? undefined : Math.max(0, Math.floor(Number(value.tokenBudget))),
        tokensUsed: Math.max(0, Math.floor(Number(value.tokensUsed ?? 0))),
        timeUsedSeconds: Math.max(0, Math.floor(Number(value.timeUsedSeconds ?? 0))),
        createdAt: Math.max(0, Math.floor(Number(value.createdAt ?? Date.now() / 1000))),
        updatedAt: Math.max(0, Math.floor(Number(value.updatedAt ?? Date.now() / 1000))),
    };
}
function normalizeGoalStatus(value) {
    switch (value) {
        case 'active':
        case 'paused':
        case 'blocked':
        case 'usageLimited':
        case 'budgetLimited':
        case 'complete':
            return value;
        case 'completed':
            return 'complete';
        case 'usage_limited':
            return 'usageLimited';
        case 'budget_limited':
            return 'budgetLimited';
        default:
            return 'active';
    }
}
export function modelMetadata(model) {
    return {
        provider: model.provider.id,
        name: model.model ?? model.provider.defaultModel,
    };
}
export function generateThreadId(now = Date.now()) {
    return `thread_${now}_${shortId()}`;
}
function defaultThreadTitle(threadId) {
    return threadId;
}
function sanitizeThreadId(threadId) {
    if (!/^[A-Za-z0-9_-]+$/.test(threadId)) {
        throw new Error(`Invalid threadId: ${threadId}`);
    }
    return threadId;
}
async function ensureThreadFiles(path) {
    await mkdir(path, { recursive: true });
    await writeIfMissing(join(path, EVENTS_FILE), '');
    await writeIfMissing(join(path, MESSAGES_FILE), '');
    await writeIfMissing(join(path, CHECKPOINTS_FILE), '');
    await writeIfMissing(join(path, COMPACTIONS_FILE), '');
}
async function writeIfMissing(path, content) {
    if (await exists(path))
        return;
    await writeFile(path, content, 'utf8');
}
async function writeJsonFile(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function appendJsonLine(path, value) {
    await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}
async function writeJsonLines(path, values) {
    await writeFile(path, values.map(value => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''), 'utf8');
}
async function readJsonLines(path) {
    if (!(await exists(path)))
        return [];
    const text = await readFile(path, 'utf8');
    return text
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
}
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function isDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    }
    catch {
        return false;
    }
}
function shortId() {
    return Math.random().toString(36).slice(2, 10);
}
function redactExportData(data) {
    return JSON.parse(JSON.stringify(data, redactSecrets));
}
function redactSecrets(key, value) {
    const normalized = key.toLowerCase();
    if (isSecretKey(normalized))
        return '<redacted>';
    if (typeof value === 'string')
        return redactSecretText(value);
    return value;
}
function isSecretKey(key) {
    return (key.includes('apikey') ||
        key.includes('api_key') ||
        key.includes('token') ||
        key.includes('password') ||
        key.includes('secret'));
}
function redactSecretText(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/g, 'Bearer <redacted>')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '<redacted>')
        .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>');
}
function formatThreadExportMarkdown(data) {
    const metadata = data.metadata;
    const lines = [
        `# ${metadata.title}`,
        '',
        '## Metadata',
        '',
        `- threadId: ${metadata.threadId}`,
        `- sessionId: ${metadata.sessionId}`,
        `- cwd: ${metadata.cwd}`,
        `- model: ${formatModel(metadata.model)}`,
        `- createdAt: ${formatTime(metadata.createdAtMs)}`,
        `- updatedAt: ${formatTime(metadata.updatedAtMs)}`,
    ];
    if (metadata.parentThreadId)
        lines.push(`- parentThreadId: ${metadata.parentThreadId}`);
    if (metadata.branchFromEventId)
        lines.push(`- branchFromEventId: ${metadata.branchFromEventId}`);
    lines.push('', '## Messages', '');
    if (!data.messages.length) {
        lines.push('(none)', '');
    }
    else {
        data.messages.forEach((message, index) => {
            lines.push(`### ${index + 1}. ${message.role}`, '');
            lines.push(message.content || '(empty)', '');
            if (message.toolCallId)
                lines.push(`toolCallId: ${message.toolCallId}`, '');
            if (message.toolCalls?.length) {
                lines.push(`toolCalls: ${message.toolCalls.map(toolCall => toolCall.name).join(', ')}`, '');
            }
        });
    }
    lines.push('## Checkpoints', '');
    if (!data.checkpoints.length) {
        lines.push('(none)', '');
    }
    else {
        data.checkpoints.forEach((checkpoint, index) => {
            lines.push(`${index + 1}. ${checkpoint.checkpointId} (${formatTime(checkpoint.createdAtMs)}) - messages=${checkpoint.messageCount}, events=${checkpoint.eventCount}`);
            if (checkpoint.finalTextPreview)
                lines.push(`   ${checkpoint.finalTextPreview}`);
        });
        lines.push('');
    }
    lines.push('## Compactions', '');
    if (!data.compactions.length) {
        lines.push('(none)', '');
    }
    else {
        data.compactions.forEach((compaction, index) => {
            lines.push(`${index + 1}. ${compaction.compactionId} (${formatTime(compaction.createdAtMs)}) - status=${compaction.status}, covered=${compaction.coveredMessageCount}, retained=${compaction.retainedMessageCount}, window=${compaction.windowId}`);
            if (compaction.summary)
                lines.push(`   ${previewText(compaction.summary, 500)}`);
        });
        lines.push('');
    }
    lines.push('## Events', '', `Total events: ${data.events.length}`, '');
    return `${lines.join('\n')}\n`;
}
function formatModel(model) {
    if (!model)
        return 'unknown';
    return model.name ? `${model.provider}/${model.name}` : model.provider;
}
function formatTime(value) {
    return new Date(value).toISOString();
}
function latestSuccessfulCompaction(compactions) {
    for (let index = compactions.length - 1; index >= 0; index -= 1) {
        const compaction = compactions[index];
        if (compaction?.status === 'completed')
            return compaction;
    }
    return undefined;
}
