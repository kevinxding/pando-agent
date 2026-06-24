import { agentEventToEnvelope, createInMemoryEventSequencer, } from '../protocol/index.js';
// TODO: legacy adapter. ThreadStore keeps its existing file layout while core replay reads EventEnvelope views.
export class ThreadStoreAdapter {
    store;
    workspaceId;
    constructor(store, workspaceId = 'default') {
        this.store = store;
        this.workspaceId = workspaceId;
    }
    async appendLegacyEvent(threadId, event) {
        await this.store.appendEvent(threadId, event);
        return agentEventToEnvelope(event, {
            workspaceId: this.workspaceId,
        });
    }
    async readEventEnvelopes(threadId) {
        const sequencer = createInMemoryEventSequencer();
        return (await this.store.readEvents(threadId)).map(event => agentEventToEnvelope(event, {
            workspaceId: this.workspaceId,
            sequencer,
        }));
    }
}
