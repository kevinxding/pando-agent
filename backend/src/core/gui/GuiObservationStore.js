import { ProcessFileLock } from '../store/index.js';
export class GuiObservationStore {
    actionStore;
    observationStore;
    actionLock;
    observationLock;
    constructor(actionStore, observationStore = actionStore) {
        this.actionStore = actionStore;
        this.observationStore = observationStore;
        this.actionLock = new ProcessFileLock(actionStore.path);
        this.observationLock = new ProcessFileLock(observationStore.path);
    }
    record(action) {
        return this.actionStore.appendLocked(action, this.actionLock, { reason: 'gui action record append' });
    }
    recordObservation(observation) {
        return this.observationStore.appendLocked(observation, this.observationLock, { reason: 'gui observation append' });
    }
    async readAll() {
        return this.actionStore.readRecords();
    }
    async readActionsWithWarnings() {
        const result = await this.actionStore.readWithCorruption();
        return { records: result.records, warnings: corruptWarnings('gui action', result.corruptRecords) };
    }
    async readObservationsWithWarnings() {
        const result = await this.observationStore.readWithCorruption();
        return { records: result.records, warnings: corruptWarnings('gui observation', result.corruptRecords) };
    }
    async readByActionId(guiActionId) {
        return (await this.actionStore.readRecords()).reverse().find(record => record.identity.guiActionId === guiActionId);
    }
    async readLatestObservation() {
        return (await this.observationStore.readRecords()).sort((left, right) => right.createdAtMs - left.createdAtMs)[0];
    }
    async listRecentActions(limit = 20) {
        return (await this.actionStore.readRecords())
            .sort((left, right) => right.createdAtMs - left.createdAtMs)
            .slice(0, limit);
    }
}
function corruptWarnings(kind, records) {
    return records.map(record => `${kind} jsonl corruption line ${record.lineNumber}: ${record.message}`);
}
