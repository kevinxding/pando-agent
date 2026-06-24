import { LOOP_EVENT_TYPES } from './LoopEventTypes.js';
import { projectLoopState } from './LoopProjector.js';
export class LoopRecovery {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async decideLoopRecovery(loopId) {
        const events = await this.durable.readEvents({ loopId });
        if (!events.some(event => event.eventType.startsWith('loop_'))) {
            return { decision: 'mark_corrupted', reason: 'loop has no durable loop events', loopId, warnings: [] };
        }
        const hasV2 = events.some(event => event.eventType !== LOOP_EVENT_TYPES.legacyEventBridged && isV2LoopEvent(event));
        if (!hasV2 && events.some(event => event.eventType === LOOP_EVENT_TYPES.legacyEventBridged)) {
            return { decision: 'requires_legacy_bridge', reason: 'loop only has legacy bridge events', loopId, warnings: [] };
        }
        const state = projectLoopState(events);
        if (state.status === 'completed')
            return { decision: 'already_completed', reason: 'loop is already completed', loopId, runId: state.lastRunId, warnings: state.warnings };
        if (!state.tasks.length)
            return { decision: 'mark_corrupted', reason: 'loop has no task events', loopId, runId: state.lastRunId, warnings: state.warnings };
        if (state.pendingHumanGateId)
            return { decision: 'requires_human', reason: 'loop is waiting for a human gate', loopId, runId: state.lastRunId, warnings: state.warnings };
        if (state.lastRunId) {
            const latestCheckpoint = await this.durable.readLatestCheckpoint(state.lastRunId);
            if (latestCheckpoint?.pendingExternalEffects.some(effect => !effect.confirmed))
                return { decision: 'requires_human', reason: 'latest checkpoint has pending external effects', loopId, runId: state.lastRunId, warnings: state.warnings };
            if (latestCheckpoint?.status === 'unsafe_to_replay')
                return { decision: 'requires_human', reason: 'latest checkpoint is unsafe to replay', loopId, runId: state.lastRunId, warnings: state.warnings };
            const audit = await this.durable.auditRun(state.lastRunId);
            if (!audit.ok || audit.errors.length)
                return { decision: 'mark_corrupted', reason: audit.errors[0] ?? 'durable audit failed', loopId, runId: state.lastRunId, warnings: [...state.warnings, ...audit.warnings] };
        }
        return { decision: 'recoverable_auto', reason: 'loop can be resumed without replaying unsafe effects', loopId, runId: state.lastRunId, warnings: state.warnings };
    }
    async recoverLoop(input) {
        const loopId = typeof input === 'string' ? input : input.loopId;
        const autoRun = typeof input === 'string' ? false : input.autoRun === true;
        const decision = await this.decideLoopRecovery(loopId);
        const before = projectLoopState(await this.durable.readEvents({ loopId }));
        await this.durable.appendEvent({
            eventType: LOOP_EVENT_TYPES.resumed,
            workspaceId: before.workspaceId,
            loopId,
            goalId: before.goalId,
            runId: decision.runId,
            payload: { loopId, decision: decision.decision, reason: decision.reason, force: false, autoRun },
        });
        await this.durable.appendEvent({
            eventType: LOOP_EVENT_TYPES.recoveryDecided,
            workspaceId: before.workspaceId,
            loopId,
            goalId: before.goalId,
            runId: decision.runId,
            payload: decision,
        });
        const state = projectLoopState(await this.durable.readEvents({ loopId }));
        return { decision, state, warnings: [...decision.warnings, ...state.warnings], resumed: true, autoRun };
    }
}
function isV2LoopEvent(event) {
    return event.eventType.startsWith('loop_') && event.eventType !== 'loop_iteration';
}
