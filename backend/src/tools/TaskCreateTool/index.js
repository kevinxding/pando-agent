import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalTaskStore } from '../../tasks/index.js';
import { optionalString, resolveWorkspaceCwd } from '../shared/index.js';
export const TaskCreateTool = {
    name: 'task_create',
    description: 'Create a persistent background task, optionally running a workspace-bounded shell command.',
    safety: 'external_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true, background: true },
    concurrency: 'background',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string' },
            title: { type: 'string' },
            command: { type: 'string' },
            cwd: { type: 'string' },
            goalId: { type: 'string' },
            threadId: { type: 'string' },
            loopId: { type: 'string' },
        },
    },
    isConcurrencySafe() {
        return false;
    },
    async execute(toolUse, context) {
        try {
            const cwd = resolveWorkspaceCwd(context, optionalString(toolUse.input, 'cwd'));
            const task = await new LocalTaskStore(context.cwd).createTask({
                taskId: optionalString(toolUse.input, 'taskId'),
                title: optionalString(toolUse.input, 'title'),
                command: optionalString(toolUse.input, 'command'),
                cwd: cwd.absolutePath,
                goalId: optionalString(toolUse.input, 'goalId') ?? optionalMetadataId(context, 'goalId'),
                threadId: optionalString(toolUse.input, 'threadId') ?? context.threadId,
                loopId: optionalString(toolUse.input, 'loopId') ?? optionalMetadataId(context, 'loopId'),
            });
            return createTextResult(toolUse.id, JSON.stringify(task, null, 2), true, {
                taskId: task.taskId,
                status: task.status,
                goalId: task.goalId,
                threadId: task.threadId,
                loopId: task.loopId,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_create' });
        }
    },
};
function optionalMetadataId(context, key) {
    const value = context.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
