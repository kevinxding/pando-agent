import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { previewText } from '../events/index.js';
const GOALS_DIR = '.pandoshare/goals';
const METADATA_FILE = 'metadata.json';
const OBJECTIVE_FILE = 'objective.md';
const REQUIREMENTS_FILE = 'requirements.jsonl';
const PROGRESS_FILE = 'progress.jsonl';
const EVIDENCE_FILE = 'evidence.jsonl';
const RUNS_FILE = 'runs.jsonl';
const CHECKPOINTS_FILE = 'checkpoints.jsonl';
export class LocalGoalStore {
    workspaceRoot;
    root;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.root = resolve(workspaceRoot, GOALS_DIR);
    }
    async createGoal(input) {
        const now = Date.now();
        const objective = input.objective.trim();
        if (!objective)
            throw new Error('Goal objective must not be empty');
        const goalId = sanitizeGoalId(input.goalId ?? `goal_${now}_${shortId()}`);
        const requirementTexts = input.requirements?.length ? input.requirements : [objective];
        const requirements = requirementTexts.map((text, index) => ({
            requirementId: `req_${index + 1}`,
            text: text.trim(),
            status: 'incomplete',
            createdAtMs: now,
            updatedAtMs: now,
            evidenceIds: [],
        }));
        const metadata = {
            goalId,
            title: input.title?.trim() || defaultGoalTitle(objective),
            status: 'active',
            cwd: resolve(input.cwd),
            createdAtMs: now,
            updatedAtMs: now,
            sessionId: input.sessionId,
            progressPercent: 0,
            completedRequirementCount: 0,
            incompleteRequirementCount: requirements.length,
            blockerCount: 0,
            usageRunCount: 0,
            usageTimeMs: 0,
            usageTokens: 0,
            relatedThreadIds: [],
            relatedLoopIds: [],
            relatedGatewayRunIds: [],
            relatedGuiActionIds: [],
            relatedAcceptanceRunIds: [],
            relatedFiles: [],
        };
        await mkdir(this.goalPath(goalId), { recursive: true });
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), metadata);
        await writeFile(this.filePath(goalId, OBJECTIVE_FILE), `${objective}\n`, 'utf8');
        await writeJsonLines(this.filePath(goalId, REQUIREMENTS_FILE), requirements);
        await ensureGoalFiles(this.goalPath(goalId));
        await this.appendProgress(goalId, 'Goal created.');
        await this.appendCheckpoint(goalId, 'Goal created.');
        return this.readSummary(goalId);
    }
    async listGoals(input = {}) {
        await mkdir(this.root, { recursive: true });
        const entries = await readdir(this.root);
        const summaries = [];
        for (const entry of entries) {
            try {
                const summary = await this.readSummary(entry);
                if (!input.status || summary.metadata.status === input.status)
                    summaries.push(summary);
            }
            catch {
                // Ignore malformed goal folders so one bad record does not hide the rest.
            }
        }
        const sorted = summaries.sort((left, right) => right.metadata.updatedAtMs - left.metadata.updatedAtMs);
        return input.limit === undefined ? sorted : sorted.slice(0, input.limit);
    }
    async activeGoal() {
        return (await this.listGoals({ status: 'active', limit: 1 }))[0];
    }
    async readSummary(goalId) {
        const data = await this.readExport(goalId);
        return {
            metadata: data.metadata,
            objective: data.objective,
            requirementCount: data.requirements.length,
            evidenceCount: data.evidence.length,
            runCount: data.runs.length,
            checkpointCount: data.checkpoints.length,
            latestProgress: data.progress.at(-1),
            latestEvidence: data.evidence.at(-1),
            latestCheckpoint: data.checkpoints.at(-1),
        };
    }
    async readExport(goalId) {
        const safeGoalId = sanitizeGoalId(goalId);
        return {
            metadata: JSON.parse(await readFile(this.filePath(safeGoalId, METADATA_FILE), 'utf8')),
            objective: (await readFile(this.filePath(safeGoalId, OBJECTIVE_FILE), 'utf8')).trim(),
            requirements: await readJsonLines(this.filePath(safeGoalId, REQUIREMENTS_FILE)),
            progress: await readJsonLines(this.filePath(safeGoalId, PROGRESS_FILE)),
            evidence: await readJsonLines(this.filePath(safeGoalId, EVIDENCE_FILE)),
            runs: await readJsonLines(this.filePath(safeGoalId, RUNS_FILE)),
            checkpoints: await readJsonLines(this.filePath(safeGoalId, CHECKPOINTS_FILE)),
        };
    }
    async exportGoal(goalId, format = 'md') {
        const data = await this.readExport(goalId);
        if (format === 'json')
            return `${JSON.stringify(data, null, 2)}\n`;
        return formatGoalMarkdown(data);
    }
    async updateStatus(goalId, status, message) {
        if (status === 'completed')
            return this.completeGoal(goalId);
        const data = await this.readExport(goalId);
        const metadata = this.recomputeMetadata({
            ...data.metadata,
            status,
            updatedAtMs: Date.now(),
        }, data.requirements);
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), metadata);
        await this.appendProgress(goalId, message ?? `Goal status changed to ${status}.`);
        await this.appendCheckpoint(goalId, message ?? `Goal status changed to ${status}.`);
        return this.readSummary(goalId);
    }
    async completeGoal(goalId) {
        const data = await this.readExport(goalId);
        const incomplete = data.requirements.filter(requirement => requirement.status !== 'completed');
        if (incomplete.length) {
            throw new Error(`Goal cannot complete: ${incomplete.length} requirement(s) are incomplete or blocked.`);
        }
        const missingEvidence = data.requirements.filter(requirement => !requirement.evidenceIds.length);
        if (missingEvidence.length) {
            throw new Error(`Goal cannot complete: ${missingEvidence.length} completed requirement(s) lack explicit evidence.`);
        }
        const evidenceById = new Map(data.evidence.map(item => [item.evidenceId, item]));
        const weakEvidence = data.requirements.filter(requirement => requirement.evidenceIds.every(id => {
            const evidence = evidenceById.get(id);
            return !evidence || evidence.type !== 'acceptance' || (evidence.strength !== 'direct' && evidence.strength !== 'strong');
        }));
        if (weakEvidence.length) {
            throw new Error(`Goal cannot complete: ${weakEvidence.length} requirement(s) lack direct acceptance evidence.`);
        }
        const metadata = this.recomputeMetadata({
            ...data.metadata,
            status: 'completed',
            updatedAtMs: Date.now(),
        }, data.requirements);
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), metadata);
        await this.appendProgress(goalId, 'Goal completed with explicit requirement evidence.');
        await this.appendCheckpoint(goalId, 'Goal completed with explicit requirement evidence.');
        return this.readSummary(goalId);
    }
    async updateRequirement(goalId, requirementId, patch) {
        const data = await this.readExport(goalId);
        const index = data.requirements.findIndex(requirement => requirement.requirementId === requirementId);
        if (index === -1)
            throw new Error(`Missing goal requirement: ${requirementId}`);
        const next = {
            ...data.requirements[index],
            ...patch,
            updatedAtMs: Date.now(),
        };
        data.requirements[index] = next;
        await writeJsonLines(this.filePath(goalId, REQUIREMENTS_FILE), data.requirements);
        const metadata = this.recomputeMetadata(data.metadata, data.requirements);
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), metadata);
        await this.appendProgress(goalId, `Requirement ${requirementId} changed to ${next.status}.`);
        return next;
    }
    async appendEvidence(goalId, input) {
        const data = await this.readExport(goalId);
        const evidence = {
            ...input,
            evidenceId: `evidence_${Date.now()}_${shortId()}`,
            goalId: data.metadata.goalId,
            createdAtMs: Date.now(),
        };
        await appendJsonLine(this.filePath(goalId, EVIDENCE_FILE), evidence);
        const requirements = data.requirements.map(requirement => {
            if (!evidence.requirementIds?.includes(requirement.requirementId))
                return requirement;
            return {
                ...requirement,
                evidenceIds: Array.from(new Set([...requirement.evidenceIds, evidence.evidenceId])),
                updatedAtMs: Date.now(),
            };
        });
        await writeJsonLines(this.filePath(goalId, REQUIREMENTS_FILE), requirements);
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), this.recomputeMetadata(linkMetadata(data.metadata, evidence), requirements));
        await this.appendProgress(goalId, `Evidence added: ${evidence.summary}`);
        return evidence;
    }
    async appendRun(goalId, run) {
        const record = {
            ...run,
            goalId: sanitizeGoalId(goalId),
        };
        await appendJsonLine(this.filePath(goalId, RUNS_FILE), record);
        const data = await this.readExport(goalId);
        await writeJsonFile(this.filePath(goalId, METADATA_FILE), linkMetadata(data.metadata, run));
        return record;
    }
    async appendProgress(goalId, message) {
        const data = await this.readExport(goalId);
        const progress = {
            progressId: `progress_${Date.now()}_${shortId()}`,
            goalId: data.metadata.goalId,
            createdAtMs: Date.now(),
            status: data.metadata.status,
            progressPercent: data.metadata.progressPercent,
            message,
            completedRequirementCount: data.metadata.completedRequirementCount,
            incompleteRequirementCount: data.metadata.incompleteRequirementCount,
            blockerCount: data.metadata.blockerCount,
        };
        await appendJsonLine(this.filePath(goalId, PROGRESS_FILE), progress);
        return progress;
    }
    async appendCheckpoint(goalId, summary) {
        const data = await this.readExport(goalId);
        const checkpoint = {
            checkpointId: `goal_checkpoint_${Date.now()}_${shortId()}`,
            goalId: data.metadata.goalId,
            createdAtMs: Date.now(),
            status: data.metadata.status,
            progressPercent: data.metadata.progressPercent,
            summary,
            completedRequirementCount: data.metadata.completedRequirementCount,
            incompleteRequirementCount: data.metadata.incompleteRequirementCount,
            blockerCount: data.metadata.blockerCount,
        };
        await appendJsonLine(this.filePath(goalId, CHECKPOINTS_FILE), checkpoint);
        return checkpoint;
    }
    goalPath(goalId) {
        return join(this.root, sanitizeGoalId(goalId));
    }
    filePath(goalId, filename) {
        return join(this.goalPath(goalId), filename);
    }
    recomputeMetadata(metadata, requirements) {
        const completed = requirements.filter(requirement => requirement.status === 'completed').length;
        const blocked = requirements.filter(requirement => requirement.status === 'blocked').length;
        const incomplete = requirements.length - completed;
        return {
            ...metadata,
            updatedAtMs: Date.now(),
            completedRequirementCount: completed,
            incompleteRequirementCount: incomplete,
            blockerCount: blocked,
            progressPercent: requirements.length ? Math.round((completed / requirements.length) * 100) : 0,
        };
    }
}
function linkMetadata(metadata, input) {
    const completedRun = Boolean(input.runId && input.status && input.status !== 'started');
    const durationMs = completedRun
        ? input.durationMs ?? (input.completedAtMs && input.startedAtMs ? Math.max(0, input.completedAtMs - input.startedAtMs) : 0)
        : 0;
    return {
        ...metadata,
        updatedAtMs: Date.now(),
        usageRunCount: (metadata.usageRunCount ?? 0) + (completedRun ? 1 : 0),
        usageTimeMs: (metadata.usageTimeMs ?? 0) + durationMs,
        usageTokens: (metadata.usageTokens ?? 0) + (completedRun ? input.tokenUsage ?? 0 : 0),
        relatedThreadIds: addUnique(metadata.relatedThreadIds, input.threadId),
        relatedLoopIds: addUnique(metadata.relatedLoopIds, input.loopId),
        relatedGatewayRunIds: addUnique(metadata.relatedGatewayRunIds, input.gatewayRunId),
        relatedGuiActionIds: addUnique(metadata.relatedGuiActionIds, input.guiActionId),
        relatedAcceptanceRunIds: addUnique(metadata.relatedAcceptanceRunIds, input.acceptanceRunId),
        relatedFiles: addUnique(metadata.relatedFiles, input.path),
    };
}
function addUnique(values, value) {
    if (!value || values.includes(value))
        return values;
    return [...values, value];
}
async function ensureGoalFiles(root) {
    await writeIfMissing(join(root, PROGRESS_FILE), '');
    await writeIfMissing(join(root, EVIDENCE_FILE), '');
    await writeIfMissing(join(root, RUNS_FILE), '');
    await writeIfMissing(join(root, CHECKPOINTS_FILE), '');
}
function formatGoalMarkdown(data) {
    const lines = [
        `# ${data.metadata.title}`,
        '',
        `- goalId: ${data.metadata.goalId}`,
        `- status: ${data.metadata.status}`,
        `- progress: ${data.metadata.progressPercent}%`,
        `- completedRequirements: ${data.metadata.completedRequirementCount}`,
        `- incompleteRequirements: ${data.metadata.incompleteRequirementCount}`,
        `- blockers: ${data.metadata.blockerCount}`,
        `- usageRuns: ${data.metadata.usageRunCount ?? 0}`,
        `- usageTimeMs: ${data.metadata.usageTimeMs ?? 0}`,
        `- usageTokens: ${data.metadata.usageTokens ?? 0}`,
        '',
        '## Objective',
        '',
        data.objective,
        '',
        '## Requirements',
        '',
        ...data.requirements.map(requirement => `- [${requirement.status === 'completed' ? 'x' : ' '}] ${requirement.requirementId}: ${requirement.text}${requirement.blocker ? ` (blocker: ${requirement.blocker})` : ''}`),
        '',
        '## Evidence',
        '',
        ...(data.evidence.length
            ? data.evidence.map(evidence => `- ${evidence.evidenceId} (${evidence.type}, ${evidence.strength}): ${evidence.summary}`)
            : ['- none']),
        '',
        '## Checkpoints',
        '',
        ...(data.checkpoints.length
            ? data.checkpoints.map(checkpoint => `- ${checkpoint.checkpointId}: ${checkpoint.progressPercent}% ${checkpoint.summary}`)
            : ['- none']),
        '',
    ];
    return `${lines.join('\n')}\n`;
}
function defaultGoalTitle(objective) {
    return previewText(objective, 80).replace(/\s+/g, ' ');
}
function sanitizeGoalId(goalId) {
    if (!/^[A-Za-z0-9_-]+$/.test(goalId))
        throw new Error(`Invalid goalId: ${goalId}`);
    return goalId;
}
function shortId() {
    return Math.random().toString(36).slice(2, 8);
}
async function writeIfMissing(path, content) {
    try {
        await readFile(path, 'utf8');
    }
    catch (error) {
        if (!isNotFoundError(error))
            throw error;
        await writeFile(path, content, 'utf8');
    }
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
    try {
        const text = await readFile(path, 'utf8');
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => JSON.parse(line));
    }
    catch (error) {
        if (isNotFoundError(error))
            return [];
        throw error;
    }
}
function isNotFoundError(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
