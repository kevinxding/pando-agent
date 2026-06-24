export class EventIndex {
    eventStore;
    constructor(eventStore) {
        this.eventStore = eventStore;
    }
    readRunEvents(runId) {
        return this.eventStore.readRunEvents(runId);
    }
    readThreadEvents(threadId) {
        return this.eventStore.readThreadEvents(threadId);
    }
}
