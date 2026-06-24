import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalTaskStore } from '../../tasks/index.js';
import { optionalPositiveInteger, optionalString } from '../shared/index.js';
export const TaskListTool = {
    name: 'task_list',
    description: 'List persistent Pando background tasks with optional status or goal filtering.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            status: { type: 'string' },
            goalId: { type: 'string' },
            limit: { type: 'integer', minimum: 1 },
        },
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse, context) {
        try {
            const status = optionalString(toolUse.input, 'status');
            const goalId = optionalString(toolUse.input, 'goalId');
            const limit = optionalPositiveInteger(toolUse.input, 'limit', 50);
            const tasks = (await new LocalTaskStore(context.cwd).listTasks())
                .filter(task => !status || task.status === status)
                .filter(task => !goalId || task.goalId === goalId)
                .slice(0, limit);
            return createTextResult(toolUse.id, JSON.stringify({ tasks, count: tasks.length }, null, 2), true, { taskCount: tasks.length });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_list' });
        }
    },
};
