import { AtomicFileStore, ProcessFileLock } from '../store/index.js';
export class EventSeq {
    paths;
    atomic = new AtomicFileStore();
    lock;
    constructor(paths) {
        this.paths = paths;
        this.lock = new ProcessFileLock(paths.eventSeqPath());
    }
    async next() {
        return this.lock.withLock({ reason: `event seq ${this.paths.workspaceId}` }, () => this.nextInTransaction());
    }
    async nextInTransaction() {
        const state = await this.read();
        const nextSeq = state.latestSeq + 1;
        await this.write({
            workspaceId: this.paths.workspaceId,
            latestSeq: nextSeq,
            updatedAtMs: Date.now(),
        });
        return nextSeq;
    }
    async latest() {
        return (await this.read()).latestSeq;
    }
    async repairSeqFromEvents(latestEventSeq) {
        return this.lock.withLock({ reason: `repair event seq ${this.paths.workspaceId}` }, async () => {
            const current = await this.read().catch(() => ({
                workspaceId: this.paths.workspaceId,
                latestSeq: 0,
                updatedAtMs: 0,
            }));
            const repaired = {
                workspaceId: this.paths.workspaceId,
                latestSeq: Math.max(current.latestSeq, latestEventSeq),
                updatedAtMs: Date.now(),
            };
            await this.write(repaired);
            return repaired;
        });
    }
    async read() {
        const state = await this.atomic.readJson(this.paths.eventSeqPath());
        if (!state) {
            return {
                workspaceId: this.paths.workspaceId,
                latestSeq: 0,
                updatedAtMs: 0,
            };
        }
        validateEventSeqState(state, this.paths.workspaceId);
        return state;
    }
    write(state) {
        validateEventSeqState(state, this.paths.workspaceId);
        return this.atomic.writeJson(this.paths.eventSeqPath(), state);
    }
}
function validateEventSeqState(state, workspaceId) {
    if (!state || typeof state !== 'object')
        throw new Error('Event seq state is corrupt');
    if (state.workspaceId !== workspaceId)
        throw new Error(`Event seq workspace mismatch: ${state.workspaceId}`);
    if (!Number.isInteger(state.latestSeq) || state.latestSeq < 0)
        throw new Error('Event seq latestSeq is corrupt');
    if (typeof state.updatedAtMs !== 'number' || !Number.isFinite(state.updatedAtMs))
        throw new Error('Event seq updatedAtMs is corrupt');
}
