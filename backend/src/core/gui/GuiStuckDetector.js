import { GUI_EVENT_TYPES } from './GuiEventTypes.js';
export class GuiStuckDetector {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async runWithTimeout(input) {
        const timeoutMs = input.timeoutMs ?? 30_000;
        let timeout;
        try {
            return await Promise.race([
                input.run().then(value => ({ status: 'completed', value })),
                new Promise(resolve => {
                    timeout = setTimeout(() => resolve({ status: 'stuck', message: `GUI action timed out after ${timeoutMs}ms: ${input.action}` }), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    async writeStuck(input) {
        const event = await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.actionStuck,
            workspaceId: input.identity.workspaceId,
            runId: input.identity.runId,
            loopId: input.identity.loopId,
            goalId: input.identity.goalId,
            taskId: input.identity.taskId,
            payload: {
                guiActionId: input.identity.guiActionId,
                action: input.action,
                message: input.message,
            },
        });
        return event.eventId;
    }
}
