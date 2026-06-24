import { agentEventToEnvelope } from '../protocol/index.js';
export class AgentKernelEventBridge {
    forwardedLegacyEventIds = new Set();
    convert(events, context) {
        const converted = [];
        for (const event of events) {
            if (this.forwardedLegacyEventIds.has(event.id))
                continue;
            this.forwardedLegacyEventIds.add(event.id);
            const envelope = agentEventToEnvelope(event, {
                workspaceId: context.identity.workspaceId,
                threadId: context.identity.threadId,
                runId: context.identity.runId,
                goalId: context.identity.goalId,
                loopId: context.identity.loopId,
            });
            converted.push({
                ...envelope,
                eventType: legacyLifecycleEventType(event.type) ?? envelope.eventType,
            });
        }
        return converted;
    }
}
function legacyLifecycleEventType(type) {
    if (type === 'run_started')
        return 'legacy_run_started';
    if (type === 'run_completed')
        return 'legacy_run_completed';
    if (type === 'run_failed')
        return 'legacy_run_failed';
    return undefined;
}
