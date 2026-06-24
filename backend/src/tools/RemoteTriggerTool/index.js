import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalAutomationQueue } from '../../services/automationQueue/index.js';
import { optionalString, requiredString } from '../shared/index.js';
export const RemoteTriggerTool = {
    name: 'remote_trigger',
    description: 'Record a remote trigger request that Gateway adapters can consume for mobile or external wake flows.',
    safety: 'workspace_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true, background: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            channel: { type: 'string' },
            payload: { type: 'string' },
            goalId: { type: 'string' },
            taskId: { type: 'string' },
        },
        required: ['channel', 'payload'],
    },
    async execute(toolUse, context) {
        try {
            const record = await new LocalAutomationQueue(context.cwd).createTrigger({
                channel: requiredString(toolUse.input, 'channel'),
                payload: requiredString(toolUse.input, 'payload'),
                goalId: optionalString(toolUse.input, 'goalId') ?? metadataString(context, 'goalId'),
                taskId: optionalString(toolUse.input, 'taskId') ?? metadataString(context, 'taskId'),
            });
            return createTextResult(toolUse.id, JSON.stringify(record, null, 2), true, { triggerId: record.triggerId });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'remote_trigger' });
        }
    },
};
function metadataString(context, key) {
    const value = context.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
