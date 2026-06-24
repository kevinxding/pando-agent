import { createEventEnvelope, createProtocolId, validateEventEnvelope, } from '../protocol/index.js';
import { JsonlStore, ProcessFileLock } from '../store/index.js';
import { redactDurablePayload } from './DurableRedaction.js';
import { EventSeq } from './EventSeq.js';
export class EventStore {
    paths;
    store;
    appendLock;
    seq;
    constructor(paths) {
        this.paths = paths;
        this.store = new JsonlStore(paths.eventsPath());
        this.appendLock = new ProcessFileLock(paths.eventsPath());
        this.seq = new EventSeq(paths);
    }
    async append(input, options = {}) {
        if ('seq' in input && input.seq !== undefined && !options.importMode) {
            throw new Error('Durable EventStore rejects pre-sequenced events outside import mode');
        }
        return this.appendLock.withLock({ reason: `event append ${this.paths.workspaceId}` }, async () => {
            const event = options.importMode && 'seq' in input && input.seq !== undefined
                ? this.importEvent(input)
                : await this.createDurableEventInTransaction(input);
            validateEventForStore(event);
            await this.store.append(event);
            return event;
        });
    }
    async appendMany(inputs, options = {}) {
        const written = [];
        for (const input of inputs) {
            written.push(await this.append(input, options));
        }
        return written;
    }
    async readEvents(input = {}) {
        return (await this.store.readRecords())
            .filter(event => input.threadId === undefined || event.threadId === input.threadId)
            .filter(event => input.runId === undefined || event.runId === input.runId)
            .filter(event => input.loopId === undefined || event.loopId === input.loopId)
            .sort((left, right) => left.seq - right.seq);
    }
    async readWithCorruption() {
        return this.store.readWithCorruption();
    }
    readRunEvents(runId) {
        return this.readEvents({ runId });
    }
    readThreadEvents(threadId) {
        return this.readEvents({ threadId });
    }
    async latestSeq() {
        const records = await this.store.readRecords();
        return records.reduce((latest, event) => Math.max(latest, event.seq), 0);
    }
    async hasSeq(seq) {
        return (await this.store.readRecords()).some(event => event.seq === seq);
    }
    async repairSeqFromEvents() {
        await this.seq.repairSeqFromEvents(await this.latestSeq());
    }
    async createDurableEventInTransaction(input) {
        return createEventEnvelope({
            eventId: input.eventId ?? createProtocolId('evt'),
            eventType: input.eventType,
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            runId: input.runId,
            goalId: input.goalId,
            loopId: input.loopId,
            taskId: input.taskId,
            toolCallId: input.toolCallId,
            parentEventId: input.parentEventId,
            createdAtMs: input.createdAtMs ?? Date.now(),
            seq: await this.seq.nextInTransaction(),
            payload: redactDurablePayload(input.payload),
        });
    }
    importEvent(event) {
        validateEventEnvelope(event);
        return {
            ...event,
            payload: markImportedPayload(redactDurablePayload(event.payload)),
        };
    }
}
export function validateEventForStore(event) {
    validateEventEnvelope(event);
    if (isRunEvent(event.eventType) && !event.runId) {
        throw new Error(`Run event ${event.eventType} requires runId`);
    }
    JSON.stringify(event.payload);
}
function isRunEvent(eventType) {
    return eventType.startsWith('run_') || eventType === 'kernel_persistence_failed';
}
function markImportedPayload(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return {
            ...payload,
            importMode: true,
        };
    }
    return {
        value: payload,
        importMode: true,
    };
}
