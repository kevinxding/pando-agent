import { LOOP_EVENT_TYPES } from './LoopEventTypes.js';
export class LoopLegacyAdapter {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async bridgeLegacyEvent(input) {
        await this.durable.appendEvent({
            eventType: LOOP_EVENT_TYPES.legacyEventBridged,
            workspaceId: input.workspaceId,
            loopId: input.loopId,
            goalId: input.goalId,
            createdAtMs: input.createdAtMs,
            payload: {
                loopId: input.loopId,
                status: input.status,
                legacyEventType: input.eventType,
                data: input.data,
            },
        });
    }
    async bridgeLegacyExport(workspaceId, data) {
        const projection = this.buildLegacyProjection({
            loopId: data.metadata.loopId,
            status: data.metadata.status,
            runs: data.runs,
            iterations: data.iterations,
            events: data.events,
        });
        await this.bridgeLegacyEvent({
            workspaceId,
            loopId: data.metadata.loopId,
            goalId: data.metadata.goalId,
            status: data.metadata.status,
            eventType: 'legacy_metadata',
            data: projection,
        });
        for (const event of data.events ?? []) {
            await this.bridgeLegacyEvent({
                workspaceId,
                loopId: data.metadata.loopId,
                goalId: data.metadata.goalId,
                status: event.status ?? data.metadata.status,
                eventType: event.type ?? 'legacy_event',
                createdAtMs: event.createdAtMs,
                data: event.data,
            });
        }
        return projection;
    }
    buildLegacyProjection(input) {
        return {
            loopId: input.loopId,
            status: input.status,
            iterationCount: input.iterations?.length ?? 0,
            lastRunId: [...(input.runs ?? [])].reverse().find(run => run.runId)?.runId,
            lastFailurePolicyEvent: [...(input.events ?? [])].reverse().find(event => event.type === 'loop_failure_policy_triggered')?.type,
        };
    }
}
