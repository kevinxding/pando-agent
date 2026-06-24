import { AtomicFileStore } from '../store/index.js';
import { projectLoopState } from './LoopProjector.js';
export class LoopStateStore {
    durable;
    files = new AtomicFileStore();
    constructor(durable) {
        this.durable = durable;
    }
    async read(loopId) {
        const events = await this.durable.readEvents({ loopId });
        const latestSeq = events.reduce((latest, event) => Math.max(latest, event.seq), 0);
        const cached = await this.files.readJson(this.path(loopId));
        if (cached && cached.derivedFromSeq >= latestSeq)
            return cached;
        return this.refreshFromEvents(loopId, events);
    }
    async refresh(loopId) {
        return this.refreshFromEvents(loopId, await this.durable.readEvents({ loopId }));
    }
    async refreshFromEvents(loopId, events) {
        const record = {
            derivedFromSeq: events.reduce((latest, event) => Math.max(latest, event.seq), 0),
            projectedAtMs: Date.now(),
            state: projectLoopState(events),
        };
        await this.files.writeJson(this.path(loopId), record);
        return record;
    }
    path(loopId) {
        return this.durable.paths.statePath(`loop-state-${loopId}`);
    }
}
