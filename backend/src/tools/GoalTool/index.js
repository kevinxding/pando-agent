import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalThreadStore } from '../../services/threadStore/index.js';

export const GetGoalTool = {
    name: 'get_goal',
    description: 'Read the current thread goal, including status, token budget, tokens used, and elapsed work time.',
    safety: 'read_only',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string', description: 'Optional current thread goal id for stale-call protection.' },
        },
    },
    isReadOnly: () => true,
    async execute(toolUse, context) {
        try {
            const threadId = requireThreadId(context);
            const store = new LocalThreadStore(context.cwd);
            const goal = await store.readThreadGoal(threadId);
            if (!goal)
                return createTextResult(toolUse.id, 'No active goal found for this thread.', true, { status: 'no_active_goal' });
            const expectedGoalId = optionalString(toolUse.input.goalId);
            if (expectedGoalId && expectedGoalId !== goal.goalId)
                throw new Error('Goal id does not match the current thread goal.');
            return createTextResult(toolUse.id, JSON.stringify(goalToJson(goal), null, 2), true, {
                goalId: goal.goalId,
                threadId,
                status: goal.status,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'get_goal' });
        }
    },
};

export const CreateGoalTool = {
    name: 'create_goal',
    description: 'Create a current-thread goal only when the user explicitly asks for one. Do not use this for ordinary task planning.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            objective: { type: 'string' },
            tokenBudget: { type: 'number' },
            token_budget: { type: 'number' },
        },
        required: ['objective'],
    },
    async execute(toolUse, context) {
        try {
            const threadId = requireThreadId(context);
            const objective = stringInput(toolUse.input.objective, 'objective');
            const store = new LocalThreadStore(context.cwd);
            const existing = await store.readThreadGoal(threadId);
            if (existing && existing.status !== 'complete') {
                throw new Error('An unfinished goal already exists for this thread. Ask the user before replacing it.');
            }
            if (existing) {
                await store.clearThreadGoal(threadId);
            }
            const goal = await store.setThreadGoal(threadId, {
                objective,
                tokenBudget: numericInput(toolUse.input.tokenBudget ?? toolUse.input.token_budget),
            });
            await emitGoalEvent(context, 'goal_updated', goal);
            return createTextResult(toolUse.id, JSON.stringify(goalToJson(goal), null, 2), true, {
                goalId: goal.goalId,
                threadId,
                status: goal.status,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'create_goal' });
        }
    },
};

export const UpdateGoalTool = {
    name: 'update_goal',
    description: 'Set the current thread goal to complete or blocked. Models must not pause, resume, clear, or budget-limit goals.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string', description: 'Optional current thread goal id for stale-call protection.' },
            status: { type: 'string', enum: ['complete', 'completed', 'blocked'] },
            reason: { type: 'string' },
        },
        required: ['status'],
    },
    async execute(toolUse, context) {
        try {
            const threadId = requireThreadId(context);
            const requestedStatus = stringInput(toolUse.input.status, 'status');
            const status = requestedStatus === 'completed' ? 'complete' : requestedStatus;
            if (status !== 'complete' && status !== 'blocked') {
                throw new Error('update_goal only accepts complete or blocked from model tools.');
            }
            const store = new LocalThreadStore(context.cwd);
            const goal = await store.readThreadGoal(threadId);
            if (!goal)
                throw new Error('No active goal found for this thread.');
            const expectedGoalId = optionalString(toolUse.input.goalId);
            if (expectedGoalId && expectedGoalId !== goal.goalId)
                throw new Error('Goal id does not match the current thread goal.');
            if (status === 'blocked') {
                await assertRepeatedBlockAttempt(store, context, goal, optionalString(toolUse.input.reason));
            }
            const nextGoal = await store.setThreadGoal(threadId, { ...goal, status });
            await emitGoalEvent(context, 'goal_updated', nextGoal);
            return createTextResult(toolUse.id, JSON.stringify(goalToJson(nextGoal), null, 2), true, {
                goalId: nextGoal.goalId,
                threadId,
                status: nextGoal.status,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'update_goal' });
        }
    },
};

export const GoalTools = [GetGoalTool, CreateGoalTool, UpdateGoalTool];

function requireThreadId(context) {
    if (typeof context.threadId !== 'string' || !context.threadId.trim())
        throw new Error('Goal tools require a current thread id.');
    return context.threadId.trim();
}

function goalToJson(goal) {
    return {
        goalId: goal.goalId,
        threadId: goal.threadId,
        objective: goal.objective,
        status: goal.status,
        tokenBudget: goal.tokenBudget,
        tokensUsed: goal.tokensUsed,
        timeUsedSeconds: goal.timeUsedSeconds,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
        progressPercent: goal.tokenBudget ? Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100)) : 0,
    };
}

async function emitGoalEvent(context, type, goal, extra = {}) {
    await context.emitEvent?.({
        type,
        threadId: goal.threadId,
        goal: goalToJson(goal),
        createdAtMs: Date.now(),
        ...extra,
    });
}

async function assertRepeatedBlockAttempt(store, context, goal, reason) {
    const normalizedReason = reason ?? 'blocked';
    const events = await store.readEvents(goal.threadId).catch(() => []);
    const previousAttempts = events.filter(event => event.type === 'goal_block_attempt' && event.goal?.goalId === goal.goalId && event.reason === normalizedReason);
    const attemptCount = previousAttempts.length + 1;
    await emitGoalEvent(context, 'goal_block_attempt', goal, { reason: normalizedReason, attemptCount });
    if (attemptCount < 3) {
        throw new Error('blocked requires the same blocking condition to recur for at least three consecutive attempts before update_goal may set blocked.');
    }
}

function stringInput(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numericInput(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}
