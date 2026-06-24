import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalTaskStore } from '../../tasks/index.js';
import { requiredString } from '../shared/index.js';
export const TaskGetTool = {
    name: 'task_get',
    description: 'Read persistent metadata for one Pando background task.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string' },
        },
        required: ['taskId'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse, context) {
        try {
            const task = await new LocalTaskStore(context.cwd).readTask(requiredString(toolUse.input, 'taskId'));
            return createTextResult(toolUse.id, JSON.stringify(task, null, 2), true, { taskId: task.taskId, status: task.status });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_get' });
        }
    },
};
