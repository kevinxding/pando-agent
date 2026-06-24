import { createEventEnvelope, } from '../protocol/index.js';
export class RunStateTransitionError extends Error {
    from;
    to;
    constructor(message, from, to) {
        super(message);
        this.from = from;
        this.to = to;
        this.name = 'RunStateTransitionError';
    }
}
export class RunStateMachine {
    emitEvent;
    onStateChange;
    runs = new Map();
    constructor(emitEvent, onStateChange) {
        this.emitEvent = emitEvent;
        this.onStateChange = onStateChange;
    }
    async startRun(command) {
        if (!command.runId)
            throw new Error('RunStateMachine.startRun requires command.runId');
        const runId = command.runId;
        const now = Date.now();
        const state = {
            runId,
            workspaceId: command.workspaceId,
            threadId: command.threadId,
            goalId: command.goalId,
            loopId: command.loopId,
            commandId: command.commandId,
            commandType: command.commandType,
            source: command.source,
            status: 'created',
            createdAtMs: now,
            updatedAtMs: now,
        };
        this.runs.set(runId, state);
        await this.onStateChange?.(state);
        await this.emitRunEvent('run_created', state, {
            commandId: command.commandId,
            commandType: command.commandType,
            source: command.source,
        });
        await this.transition(runId, 'started', {
            commandId: command.commandId,
            commandType: command.commandType,
            source: command.source,
        });
        await this.transition(runId, 'running', {
            commandId: command.commandId,
            commandType: command.commandType,
        });
        return this.requireRun(runId);
    }
    async resumeRun(threadId, runId) {
        const state = this.runs.get(runId);
        if (!state)
            throw new Error(`Cannot resume missing run: ${runId}`);
        if (state.threadId !== threadId)
            throw new Error(`Run ${runId} does not belong to thread ${threadId}`);
        await this.transition(runId, 'running', { reason: 'resume' });
        return this.requireRun(runId);
    }
    async interruptRun(runId, reason = 'interrupt_requested') {
        await this.transition(runId, 'interrupted', { reason });
        return this.requireRun(runId);
    }
    async completeRun(runId, payload = {}) {
        await this.transition(runId, 'completed', payload);
        return this.requireRun(runId);
    }
    async failRun(runId, error, payload = {}) {
        const message = error instanceof Error ? error.message : String(error);
        await this.transition(runId, 'failed', { ...payload, message });
        const state = this.requireRun(runId);
        const next = { ...state, lastError: message };
        this.runs.set(runId, next);
        await this.onStateChange?.(next);
        return next;
    }
    readRun(runId) {
        return this.runs.get(runId);
    }
    readActiveRuns() {
        return [...this.runs.values()]
            .filter(run => run.status === 'created' || run.status === 'started' || run.status === 'running' || run.status === 'waiting_approval')
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    }
    readRecentRuns(limit = 20) {
        return [...this.runs.values()]
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
            .slice(0, limit);
    }
    async transition(runId, to, payload) {
        const current = this.requireRun(runId);
        if (!isAllowedTransition(current.status, to)) {
            const error = new RunStateTransitionError(`Illegal run state transition: ${current.status} -> ${to}`, current.status, to);
            await this.emitRunEvent('run_failed', current, {
                message: error.message,
                attemptedStatus: to,
                fromStatus: current.status,
                toStatus: to,
            });
            throw error;
        }
        const next = {
            ...current,
            threadId: typeof payload.threadId === 'string' ? payload.threadId : current.threadId,
            status: to,
            updatedAtMs: Date.now(),
        };
        this.runs.set(runId, next);
        await this.onStateChange?.(next);
        await this.emitRunEvent(eventTypeForStatus(to), next, payload);
    }
    async emitRunEvent(eventType, state, payload) {
        if (!this.emitEvent)
            return;
        const event = createEventEnvelope({
            eventType,
            workspaceId: state.workspaceId,
            threadId: state.threadId,
            runId: state.runId,
            goalId: state.goalId,
            loopId: state.loopId,
            payload: {
                status: state.status,
                commandId: state.commandId,
                commandType: state.commandType,
                source: state.source,
                ...payload,
            },
        });
        await this.emitEvent(event);
    }
    requireRun(runId) {
        const state = this.runs.get(runId);
        if (!state)
            throw new Error(`Missing run state: ${runId}`);
        return state;
    }
}
function isAllowedTransition(from, to) {
    if (from === to)
        return true;
    const allowed = {
        created: ['started', 'failed', 'interrupted'],
        started: ['running', 'failed', 'interrupted'],
        running: ['waiting_approval', 'completed', 'failed', 'interrupted'],
        waiting_approval: ['running', 'completed', 'failed', 'interrupted'],
        completed: [],
        failed: [],
        interrupted: [],
    };
    return allowed[from].includes(to);
}
function eventTypeForStatus(status) {
    switch (status) {
        case 'started':
            return 'run_start';
        case 'running':
            return 'run_running';
        case 'completed':
            return 'run_complete';
        case 'failed':
            return 'run_failed';
        case 'waiting_approval':
            return 'approval';
        case 'interrupted':
            return 'run_interrupted';
        case 'created':
            return 'run_created';
    }
}
