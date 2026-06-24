export class ConsistencyAudit {
    run(input) {
        const warnings = [...(input.corruptionWarnings ?? [])];
        const errors = [];
        const events = [...input.events].sort((left, right) => left.seq - right.seq);
        const latestSeq = events.reduce((latest, event) => Math.max(latest, event.seq), 0);
        const seqSet = new Set(events.map(event => event.seq));
        const eventIds = new Set();
        const seenEventIds = new Set();
        let lastSeq = 0;
        for (const event of events) {
            if (event.seq < lastSeq)
                errors.push(`event seq out of order at ${event.eventId}`);
            lastSeq = event.seq;
            if (eventIds.has(event.eventId))
                errors.push(`duplicate eventId: ${event.eventId}`);
            eventIds.add(event.eventId);
            if (event.parentEventId && !seenEventIds.has(event.parentEventId)) {
                errors.push(`parentEventId ${event.parentEventId} does not reference an earlier event`);
            }
            seenEventIds.add(event.eventId);
        }
        const runStartIndex = events.findIndex(event => event.eventType === 'run_start');
        const terminalEvents = events.filter(event => isTerminal(event.eventType));
        if (terminalEvents.length > 1)
            errors.push('run has more than one terminal event');
        if (runStartIndex >= 0 && terminalEvents[0]) {
            const terminalIndex = events.findIndex(event => event.eventId === terminalEvents[0]?.eventId);
            if (terminalIndex < runStartIndex)
                errors.push('terminal event appears before run_start');
        }
        for (const checkpoint of input.checkpoints) {
            if (checkpoint.lastEventSeq > 0 && !seqSet.has(checkpoint.lastEventSeq)) {
                errors.push(`checkpoint ${checkpoint.checkpointId} references missing event seq ${checkpoint.lastEventSeq}`);
            }
        }
        for (const snapshot of input.snapshots) {
            if (snapshot.lastEventSeq > 0 && !seqSet.has(snapshot.lastEventSeq)) {
                errors.push(`snapshot ${snapshot.snapshotId} references missing event seq ${snapshot.lastEventSeq}`);
            }
        }
        const terminalStatus = terminalEvents[0] ? statusForTerminal(terminalEvents[0].eventType) : undefined;
        if (input.latestRun && terminalStatus && input.latestRun.status !== terminalStatus) {
            errors.push(`run ledger status ${input.latestRun.status} drifts from terminal event ${terminalStatus}`);
        }
        const latestSnapshot = [...input.snapshots].sort((left, right) => right.lastEventSeq - left.lastEventSeq)[0];
        if (input.latestRun && latestSnapshot && input.latestRun.status !== latestSnapshot.status) {
            errors.push(`run ledger status ${input.latestRun.status} drifts from snapshot status ${latestSnapshot.status}`);
        }
        if (!events.length)
            warnings.push('run has no durable events');
        return {
            ok: errors.length === 0,
            warnings,
            errors,
            latestSeq,
            eventCount: events.length,
            latestCheckpoint: [...input.checkpoints].sort((left, right) => right.lastEventSeq - left.lastEventSeq)[0],
            latestSnapshot,
            recoveryDecision: input.recoveryDecision,
        };
    }
}
function isTerminal(eventType) {
    return eventType === 'run_complete' || eventType === 'run_failed' || eventType === 'run_interrupted';
}
function statusForTerminal(eventType) {
    if (eventType === 'run_complete')
        return 'completed';
    if (eventType === 'run_failed')
        return 'failed';
    if (eventType === 'run_interrupted')
        return 'interrupted';
    return undefined;
}
