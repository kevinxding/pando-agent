import { normalizeReplayQuery } from './ReplayQuery.js';
export class ReplayEventReader {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async readForQuery(input) {
        const query = normalizeReplayQuery(input);
        const warnings = [];
        let events = await this.readScoped(query);
        events = filterRange(events, query);
        if (query.followRelated)
            events = await this.followRelated(events, query, warnings);
        events = filterLegacy(events, query.includeLegacy ?? true);
        events = sortEvents(uniqueEvents(events));
        for (const event of events) {
            if (!event.eventId || !event.eventType || !event.workspaceId)
                warnings.push(`event ${event.seq} missing required replay field`);
        }
        return { events, warnings };
    }
    readRun(runId) {
        return this.durable.readRunEvents(runId);
    }
    readThread(threadId) {
        return this.durable.readThreadEvents(threadId);
    }
    readLoop(loopId) {
        return this.durable.readEvents({ loopId });
    }
    async readGoal(goalId) {
        return (await this.durable.readEvents()).filter(event => event.goalId === goalId || stringPayload(event.payload, 'goalId') === goalId);
    }
    async readGuiAction(guiActionId) {
        return (await this.durable.readEvents()).filter(event => event.eventType.startsWith('gui_') && (stringPayload(event.payload, 'guiActionId') === guiActionId || stringPayload(event.payload, 'actionId') === guiActionId));
    }
    async readGatewayInbound(inboundId) {
        return (await this.durable.readEvents()).filter(event => event.eventType.startsWith('gateway_') && stringPayload(event.payload, 'inboundId') === inboundId);
    }
    async readGatewayDelivery(deliveryId) {
        return (await this.durable.readEvents()).filter(event => event.eventType.startsWith('gateway_') && stringPayload(event.payload, 'deliveryId') === deliveryId);
    }
    async readModelRoute(routeId) {
        return (await this.durable.readEvents()).filter(event => event.eventType.startsWith('model_') && stringPayload(event.payload, 'routeId') === routeId);
    }
    async readCheckpoint(checkpointId) {
        return (await this.durable.readEvents()).filter(event => event.eventType === 'checkpoint' && (stringPayload(event.payload, 'checkpointId') === checkpointId || event.eventId === checkpointId));
    }
    async readRange(fromSeq, toSeq) {
        return (await this.durable.readEvents()).filter(event => event.seq >= fromSeq && event.seq <= toSeq);
    }
    async readScoped(query) {
        switch (query.scope) {
            case 'run': return this.readRun(query.runId);
            case 'thread': return this.readThread(query.threadId);
            case 'loop': return this.readLoop(query.loopId);
            case 'goal': return this.readGoal(query.goalId);
            case 'gui_action': return this.readGuiAction(query.guiActionId);
            case 'gateway_inbound': return this.readGatewayInbound(query.inboundId);
            case 'gateway_delivery': return this.readGatewayDelivery(query.deliveryId);
            case 'model_route': return this.readModelRoute(query.routeId);
            case 'checkpoint': return this.readCheckpoint(query.checkpointId);
            case 'time_range': return this.durable.readEvents();
            case 'workspace': return this.durable.readEvents();
        }
    }
    async followRelated(seed, query, warnings) {
        const depth = query.followDepth ?? 3;
        if (depth <= 0 || seed.length === 0)
            return [...seed];
        const all = await this.durable.readEvents();
        let result = uniqueEvents(seed);
        for (let level = 0; level < depth; level += 1) {
            const ids = collectIds(result);
            const expanded = all.filter(event => related(event, ids));
            const next = uniqueEvents([...result, ...expanded]);
            if (next.length === result.length)
                break;
            if (next.length > 2000) {
                warnings.push('followRelated stopped after reaching 2000 events');
                return sortEvents(next.slice(0, 2000));
            }
            result = next;
        }
        return result;
    }
}
function related(event, ids) {
    if (ids.has(event.eventId))
        return true;
    if (event.parentEventId && ids.has(event.parentEventId))
        return true;
    for (const value of eventIds(event))
        if (ids.has(value))
            return true;
    return false;
}
function collectIds(events) {
    const ids = new Set();
    for (const event of events) {
        ids.add(event.eventId);
        for (const value of eventIds(event))
            ids.add(value);
    }
    return ids;
}
function eventIds(event) {
    const values = [event.runId, event.threadId, event.loopId, event.goalId, event.taskId, event.toolCallId];
    const payload = recordPayload(event.payload);
    for (const key of ['runId', 'threadId', 'loopId', 'goalId', 'taskId', 'attemptId', 'guiActionId', 'inboundId', 'deliveryId', 'routeId', 'checkpointId', 'commandId', 'approvalId']) {
        const value = payload[key];
        if (typeof value === 'string')
            values.push(value);
    }
    return values.filter((value) => Boolean(value));
}
function filterRange(events, query) {
    return events
        .filter(event => query.fromSeq === undefined || event.seq >= query.fromSeq)
        .filter(event => query.toSeq === undefined || event.seq <= query.toSeq)
        .filter(event => query.fromTimeMs === undefined || event.createdAtMs >= query.fromTimeMs)
        .filter(event => query.toTimeMs === undefined || event.createdAtMs <= query.toTimeMs);
}
function filterLegacy(events, includeLegacy) {
    if (includeLegacy)
        return [...events];
    return events.filter(event => !isLegacy(event));
}
function isLegacy(event) {
    return event.eventType.includes('legacy') || Boolean(stringPayload(event.payload, 'legacyRunId'));
}
function uniqueEvents(events) {
    const byId = new Map();
    for (const event of events)
        byId.set(event.eventId, event);
    return [...byId.values()];
}
function sortEvents(events) {
    return [...events].sort((left, right) => left.seq - right.seq || left.createdAtMs - right.createdAtMs || left.eventId.localeCompare(right.eventId));
}
function stringPayload(value, key) {
    const record = recordPayload(value);
    const item = record[key];
    return typeof item === 'string' && item.trim() ? item : undefined;
}
function recordPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
