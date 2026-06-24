import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalAutomationQueue } from '../../services/automationQueue/index.js';
import { optionalString, requiredString } from '../shared/index.js';
export const SendMessageTool = {
    name: 'send_message',
    description: 'Queue a message for a Gateway/mobile channel without requiring the real adapter to be configured.',
    safety: 'external_write',
    platforms: ['all'],
    behavior: { writes: true, network: true, background: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            channel: { type: 'string' },
            recipient: { type: 'string' },
            text: { type: 'string' },
            goalId: { type: 'string' },
            taskId: { type: 'string' },
        },
        required: ['channel', 'text'],
    },
    async execute(toolUse, context) {
        try {
            const record = await new LocalAutomationQueue(context.cwd).createMessage({
                channel: requiredString(toolUse.input, 'channel'),
                recipient: optionalString(toolUse.input, 'recipient') ?? 'default',
                text: requiredString(toolUse.input, 'text'),
                goalId: optionalString(toolUse.input, 'goalId') ?? metadataString(context, 'goalId'),
                taskId: optionalString(toolUse.input, 'taskId') ?? metadataString(context, 'taskId'),
            });
            return createTextResult(toolUse.id, JSON.stringify(record, null, 2), true, { messageId: record.messageId, channel: record.channel });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'send_message' });
        }
    },
};
function metadataString(context, key) {
    const value = context.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
