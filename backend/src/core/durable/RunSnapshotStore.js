import { createProtocolId } from '../protocol/index.js';
import { ProcessFileLock } from '../store/index.js';
export class RunSnapshotStore {
    store;
    lock;
    constructor(store) {
        this.store = store;
        this.lock = new ProcessFileLock(store.path);
    }
    async writeSnapshot(input) {
        assertJsonSerializable(input);
        const snapshot = {
            snapshotId: input.snapshotId ?? createProtocolId('snapshot'),
            workspaceId: input.workspaceId,
            runId: input.runId,
            threadId: input.threadId,
            status: input.status,
            lastEventSeq: input.lastEventSeq,
            activePhase: input.activePhase,
            activeToolCallId: input.activeToolCallId,
            activeApprovalId: input.activeApprovalId,
            activeModelRequestId: input.activeModelRequestId,
            loopTaskId: input.loopTaskId,
            guiActionId: input.guiActionId,
            gatewayDeliveryId: input.gatewayDeliveryId,
            retryCount: input.retryCount ?? 0,
            createdAtMs: input.createdAtMs ?? Date.now(),
        };
        await this.store.appendLocked(snapshot, this.lock, { reason: 'run snapshot append' });
        return snapshot;
    }
    async readSnapshots(runId) {
        return (await this.store.readRecords())
            .filter(snapshot => snapshot.runId === runId)
            .sort((left, right) => left.lastEventSeq - right.lastEventSeq || left.createdAtMs - right.createdAtMs);
    }
    async readLatestSnapshot(runId) {
        return (await this.readSnapshots(runId)).sort((left, right) => {
            if (right.lastEventSeq !== left.lastEventSeq)
                return right.lastEventSeq - left.lastEventSeq;
            return right.createdAtMs - left.createdAtMs;
        })[0];
    }
    async readWithCorruption() {
        return this.store.readWithCorruption();
    }
}
function assertJsonSerializable(value) {
    JSON.stringify(value);
}
