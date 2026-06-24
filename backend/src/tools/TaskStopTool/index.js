import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalTaskStore } from '../../tasks/index.js';
import { optionalString, requiredString } from '../shared/index.js';
export const TaskStopTool = {
    name: 'task_stop',
    description: 'Stop a running Pando background task and persist the stopped state.',
    safety: 'external_write',
    platforms: ['all'],
    behavior: { writes: true, background: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string' },
            reason: { type: 'string' },
        },
        required: ['taskId'],
    },
    async execute(toolUse, context) {
        try {
            const task = await new LocalTaskStore(context.cwd).stopTask(requiredString(toolUse.input, 'taskId'), optionalString(toolUse.input, 'reason') ?? 'Stopped by task_stop.');
            return createTextResult(toolUse.id, JSON.stringify(task, null, 2), true, { taskId: task.taskId, status: task.status });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_stop' });
        }
    },
};
