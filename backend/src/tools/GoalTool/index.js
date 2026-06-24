import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { GoalService } from '../../services/goalService/index.js';
import { LocalGoalStore } from '../../services/goalStore/index.js';
export const GetGoalTool = {
    name: 'get_goal',
    description: 'Read the active Pando goal or a specific goal by id, including objective, requirements, evidence, usage, and checkpoints.',
    safety: 'read_only',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string', description: 'Optional ASCII goal id. Defaults to the active goal.' },
        },
    },
    isReadOnly: () => true,
    async execute(toolUse, context) {
        try {
            const service = new GoalService(new LocalGoalStore(context.cwd));
            const goalId = typeof toolUse.input.goalId === 'string' && toolUse.input.goalId.trim()
                ? toolUse.input.goalId.trim()
                : (await service.activeGoal())?.metadata.goalId;
            if (!goalId)
                return createTextResult(toolUse.id, 'No active goal found.', true, { status: 'no_active_goal' });
            const data = await service.readGoal(goalId);
            return createTextResult(toolUse.id, JSON.stringify(data, null, 2), true, {
                goalId,
                status: data.metadata.status,
                progressPercent: data.metadata.progressPercent,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'get_goal' });
        }
    },
};
export const CreateGoalTool = {
    name: 'create_goal',
    description: 'Create a first-class Pando goal with objective text and optional explicit requirements.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string' },
            title: { type: 'string' },
            objective: { type: 'string' },
            requirements: { type: 'array', items: { type: 'string' } },
        },
        required: ['objective'],
    },
    async execute(toolUse, context) {
        try {
            const objective = stringInput(toolUse.input.objective, 'objective');
            const service = new GoalService(new LocalGoalStore(context.cwd));
            const summary = await service.createGoal({
                goalId: optionalString(toolUse.input.goalId),
                title: optionalString(toolUse.input.title),
                objective,
                requirements: arrayStringInput(toolUse.input.requirements),
                sessionId: context.sessionId,
                cwd: context.cwd,
            });
            return createTextResult(toolUse.id, JSON.stringify(summary, null, 2), true, {
                goalId: summary.metadata.goalId,
                status: summary.metadata.status,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'create_goal' });
        }
    },
};
export const UpdateGoalTool = {
    name: 'update_goal',
    description: 'Request a conservative terminal update for a Pando goal. Models may only request completed or blocked; pause/resume are user-controlled.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            goalId: { type: 'string', description: 'Optional ASCII goal id. Defaults to active goal.' },
            status: { type: 'string', enum: ['completed', 'blocked'] },
            reason: { type: 'string' },
        },
        required: ['status'],
    },
    async execute(toolUse, context) {
        try {
            const status = stringInput(toolUse.input.status, 'status');
            if (status !== 'completed' && status !== 'blocked') {
                throw new Error('update_goal only accepts completed or blocked from model tools.');
            }
            const service = new GoalService(new LocalGoalStore(context.cwd));
            const goalId = optionalString(toolUse.input.goalId) ?? (await service.activeGoal())?.metadata.goalId;
            if (!goalId)
                throw new Error('No active goal found.');
            const summary = await service.updateGoal(goalId, {
                status,
                reason: optionalString(toolUse.input.reason),
                source: 'tool',
            });
            return createTextResult(toolUse.id, JSON.stringify(summary, null, 2), true, {
                goalId,
                status: summary.metadata.status,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'update_goal' });
        }
    },
};
export const GoalTools = [GetGoalTool, CreateGoalTool, UpdateGoalTool];
function stringInput(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function arrayStringInput(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        throw new Error('requirements must be an array of strings');
    return value.filter((item) => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim());
}
