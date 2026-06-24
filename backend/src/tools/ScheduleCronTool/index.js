import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalAutomationQueue } from '../../services/automationQueue/index.js';
import { optionalString, requiredString } from '../shared/index.js';
export const ScheduleCronTool = {
    name: 'schedule_cron',
    description: 'Register a local cron-like schedule record for Gateway/heartbeat driven goal or task continuation.',
    safety: 'workspace_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true, background: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            schedule: { type: 'string' },
            command: { type: 'string' },
            goalId: { type: 'string' },
            taskId: { type: 'string' },
            loopId: { type: 'string' },
        },
        required: ['schedule', 'command'],
    },
    async execute(toolUse, context) {
        try {
            const record = await new LocalAutomationQueue(context.cwd).createSchedule({
                schedule: requiredString(toolUse.input, 'schedule'),
                command: requiredString(toolUse.input, 'command'),
                goalId: optionalString(toolUse.input, 'goalId') ?? metadataString(context, 'goalId'),
                taskId: optionalString(toolUse.input, 'taskId') ?? metadataString(context, 'taskId'),
                loopId: optionalString(toolUse.input, 'loopId') ?? metadataString(context, 'loopId'),
            });
            return createTextResult(toolUse.id, JSON.stringify(record, null, 2), true, { scheduleId: record.scheduleId });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'schedule_cron' });
        }
    },
};
function metadataString(context, key) {
    const value = context.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
