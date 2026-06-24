export class RecoveryPlanner {
    decide(input) {
        if (input.corruptionErrors?.length) {
            return decision(input.runId, 'mark_corrupted', input.corruptionErrors[0] ?? 'corruption detected');
        }
        if (input.latestRun?.status === 'completed') {
            return decision(input.runId, 'already_completed', 'run already completed', true);
        }
        if (input.latestHeartbeat && input.heartbeatAgeMs !== undefined && input.heartbeatAgeMs <= input.heartbeatTtlMs) {
            return decision(input.runId, 'requires_human', 'run has active heartbeat');
        }
        if (input.latestCheckpoint?.pendingExternalEffects.length) {
            return decision(input.runId, 'requires_human', 'pending external effects require human review');
        }
        if (input.latestRun?.status === 'interrupted' || input.latestSnapshot?.status === 'interrupted') {
            return decision(input.runId, 'requires_human', 'interrupted run requires human review');
        }
        if (input.latestRun?.status === 'failed') {
            if (input.latestCheckpoint?.status === 'partial_replay' && !input.latestCheckpoint.pendingExternalEffects.length) {
                return decision(input.runId, 'recoverable_auto', 'failed run has partial replay checkpoint without pending effects', true);
            }
            return decision(input.runId, 'mark_failed', 'run already failed');
        }
        if (input.latestSnapshot && !isAutoRecoverablePhase(input.latestSnapshot.activePhase)) {
            return decision(input.runId, 'requires_human', `phase ${input.latestSnapshot.activePhase} is not auto recoverable`);
        }
        return decision(input.runId, 'recoverable_auto', 'run is recoverable from durable state', true);
    }
}
function decision(runId, kind, reason, recoverable = false) {
    return {
        decision: kind,
        reason,
        runId,
        recoverable,
    };
}
function isAutoRecoverablePhase(phase) {
    return phase === 'starting' || phase === 'model' || phase === 'checkpoint';
}
