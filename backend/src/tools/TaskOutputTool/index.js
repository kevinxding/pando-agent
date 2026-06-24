import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalTaskStore } from '../../tasks/index.js';
import { optionalPositiveInteger, requiredString } from '../shared/index.js';
export const TaskOutputTool = {
    name: 'task_output',
    description: 'Read captured stdout/stderr output for one persistent background task.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string' },
            maxChars: { type: 'integer', minimum: 1 },
        },
        required: ['taskId'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse, context) {
        try {
            const taskId = requiredString(toolUse.input, 'taskId');
            const output = await new LocalTaskStore(context.cwd).readOutput(taskId, optionalPositiveInteger(toolUse.input, 'maxChars', 20_000));
            return createTextResult(toolUse.id, output.text, true, { taskId, truncated: output.truncated });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'task_output' });
        }
    },
};
