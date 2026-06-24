import { createProtocolId } from '../protocol/index.js';
import { ProcessFileLock } from '../store/index.js';
import { redactDurablePayload } from './DurableRedaction.js';
import { SideEffectClassifier } from './SideEffectClassifier.js';
import { validateCheckpoint, } from './CheckpointTypes.js';
export class CheckpointStore {
    store;
    lock;
    classifier = new SideEffectClassifier();
    constructor(store) {
        this.store = store;
        this.lock = new ProcessFileLock(store.path);
    }
    async createCheckpoint(input, latestEventSeq) {
        const classified = this.classifier.classifyMany(input.effectHints);
        const classifiedPending = classified
            .filter(effect => effect.requiresHuman && !effect.confirmed)
            .map(effect => ({
            effectId: effect.effectId,
            effectType: effect.effectType,
            summary: effect.summary,
            confirmed: effect.confirmed,
        }));
        const pendingExternalEffects = [
            ...(input.pendingExternalEffects ?? []),
            ...classifiedPending,
        ];
        const requestedStatus = input.status ?? 'safe_to_replay';
        const status = requestedStatus === 'unsafe_to_replay'
            ? 'unsafe_to_replay'
            : pendingExternalEffects.length && requestedStatus === 'safe_to_replay'
                ? 'partial_replay'
                : requestedStatus;
        const checkpoint = {
            checkpointId: input.checkpointId ?? createProtocolId('checkpoint'),
            workspaceId: input.workspaceId,
            runId: input.runId,
            threadId: input.threadId,
            goalId: input.goalId,
            loopId: input.loopId,
            commandId: input.commandId,
            status,
            reason: input.reason,
            lastEventSeq: input.lastEventSeq ?? latestEventSeq,
            createdAtMs: input.createdAtMs ?? Date.now(),
            summary: input.summary ?? 'checkpoint',
            snapshotRef: input.snapshotRef,
            unsafeToReplayToolCallIds: [...(input.unsafeToReplayToolCallIds ?? [])],
            pendingExternalEffects,
            payload: redactDurablePayload(input.payload),
        };
        validateCheckpoint(checkpoint, latestEventSeq);
        await this.store.appendLocked(checkpoint, this.lock, { reason: 'checkpoint append' });
        return checkpoint;
    }
    async readLatestCheckpoint(input = {}) {
        return (await this.readCheckpoints(input)).sort((left, right) => {
            if (right.lastEventSeq !== left.lastEventSeq)
                return right.lastEventSeq - left.lastEventSeq;
            return right.createdAtMs - left.createdAtMs;
        })[0];
    }
    async readCheckpoints(input = {}) {
        return (await this.store.readRecords())
            .filter(record => input.threadId === undefined || record.threadId === input.threadId)
            .filter(record => input.runId === undefined || record.runId === input.runId)
            .filter(record => input.goalId === undefined || record.goalId === input.goalId)
            .filter(record => input.loopId === undefined || record.loopId === input.loopId);
    }
    async readWithCorruption() {
        return this.store.readWithCorruption();
    }
    async markUnsafeToReplay(checkpointId, reason, latestEventSeq) {
        const existing = (await this.store.readRecords()).find(record => record.checkpointId === checkpointId);
        if (!existing)
            throw new Error(`Missing checkpoint: ${checkpointId}`);
        return this.createCheckpoint({
            ...existing,
            checkpointId: `${checkpointId}_unsafe_${Date.now()}`,
            status: 'unsafe_to_replay',
            reason,
        }, latestEventSeq);
    }
}
