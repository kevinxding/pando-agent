import { JsonlStore, ProcessFileLock } from '../store/index.js';
export class RunLedgerStore {
    store;
    lock;
    constructor(store) {
        this.store = store;
        this.lock = new ProcessFileLock(store.path);
    }
    static fromRuntimePaths(paths) {
        return new RunLedgerStore(new JsonlStore(paths.queuePath('agent-run-ledger')));
    }
    async append(state) {
        const entry = 'workspaceId' in state && 'lastError' in state
            ? runStateToLedgerEntry(state)
            : normalizeLedgerEntry(state);
        await this.store.appendLocked(entry, this.lock, { reason: 'run ledger append' });
        return entry;
    }
    async readRun(runId) {
        return latestByRun(await this.store.readRecords()).get(runId);
    }
    async readActiveRuns() {
        return [...latestByRun(await this.store.readRecords()).values()]
            .filter(entry => isActiveStatus(entry.status))
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    }
    async readRecentRuns(limit = 20) {
        return [...latestByRun(await this.store.readRecords()).values()]
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
            .slice(0, limit);
    }
}
function runStateToLedgerEntry(state) {
    return {
        runId: state.runId,
        workspaceId: state.workspaceId,
        threadId: state.threadId,
        goalId: state.goalId,
        loopId: state.loopId,
        commandId: state.commandId,
        commandType: state.commandType,
        source: state.source,
        status: state.status,
        createdAtMs: state.createdAtMs,
        updatedAtMs: state.updatedAtMs,
        error: state.lastError,
    };
}
function normalizeLedgerEntry(entry) {
    return { ...entry };
}
function latestByRun(entries) {
    const latest = new Map();
    for (const entry of entries) {
        const existing = latest.get(entry.runId);
        if (!existing || entry.updatedAtMs >= existing.updatedAtMs) {
            latest.set(entry.runId, entry);
        }
    }
    return latest;
}
function isActiveStatus(status) {
    return status === 'created' || status === 'started' || status === 'running' || status === 'waiting_approval';
}
