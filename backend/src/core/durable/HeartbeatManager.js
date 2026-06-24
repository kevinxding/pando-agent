import { createProtocolId } from '../protocol/index.js';
import { ProcessFileLock } from '../store/index.js';
import { redactDurablePayload } from './DurableRedaction.js';
export class HeartbeatManager {
    store;
    lock;
    constructor(store) {
        this.store = store;
        this.lock = new ProcessFileLock(store.path);
    }
    async writeHeartbeat(input) {
        const workerId = input.workerId ?? input.runtimeId;
        if (!workerId)
            throw new Error('Heartbeat requires workerId');
        const workerType = input.workerType ?? workerTypeFromLegacyKernel(input.kernel);
        const heartbeatAt = input.lastHeartbeatAtMs ?? input.createdAtMs ?? Date.now();
        const heartbeat = {
            heartbeatId: input.heartbeatId ?? createProtocolId('heartbeat'),
            workspaceId: input.workspaceId,
            workerId,
            workerType,
            runId: input.runId,
            loopId: input.loopId,
            gatewayId: input.gatewayId,
            pid: input.pid,
            status: input.status,
            lastSeq: input.lastSeq,
            lastHeartbeatAtMs: heartbeatAt,
            metadata: redactDurablePayload(input.metadata),
            runtimeId: workerId,
            kernel: input.kernel ?? workerType,
            message: input.message,
            payload: redactDurablePayload(input.payload),
        };
        await this.store.appendLocked(heartbeat, this.lock, { reason: 'heartbeat append' });
        return heartbeat;
    }
    async readHeartbeat(workerId) {
        return (await this.listHeartbeats({ workerId })).sort((left, right) => right.lastHeartbeatAtMs - left.lastHeartbeatAtMs)[0];
    }
    async readRunHeartbeat(runId) {
        return (await this.listHeartbeats({ runId })).sort((left, right) => right.lastHeartbeatAtMs - left.lastHeartbeatAtMs)[0];
    }
    async listHeartbeats(input = {}) {
        return (await this.store.readRecords())
            .filter(record => input.workerId === undefined || record.workerId === input.workerId)
            .filter(record => input.runtimeId === undefined || record.runtimeId === input.runtimeId)
            .filter(record => input.workerType === undefined || record.workerType === input.workerType)
            .filter(record => input.kernel === undefined || record.kernel === input.kernel)
            .filter(record => input.runId === undefined || record.runId === input.runId);
    }
    async readWithCorruption() {
        return this.store.readWithCorruption();
    }
    async isStale(workerId, nowMs, ttlMs) {
        const heartbeat = await this.readHeartbeat(workerId);
        if (!heartbeat)
            return true;
        return nowMs - heartbeat.lastHeartbeatAtMs > ttlMs;
    }
}
function workerTypeFromLegacyKernel(kernel) {
    if (kernel === 'agent' || kernel === 'loop' || kernel === 'gateway' || kernel === 'gui' || kernel === 'model' || kernel === 'test') {
        return kernel;
    }
    return 'test';
}
