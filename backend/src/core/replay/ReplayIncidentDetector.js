export class ReplayIncidentDetector {
    detect(input) {
        const incidents = [];
        const events = [...input.events].sort((left, right) => left.seq - right.seq);
        const byId = new Set(events.map(event => event.eventId));
        for (const event of events) {
            if (event.parentEventId && !byId.has(event.parentEventId))
                add(incidents, 'missing_parent_event', 'error', `Missing parent event ${event.parentEventId}`, [event]);
            if (unknownEvent(event.eventType))
                add(incidents, 'unknown_event_type', 'info', `Unknown event type ${event.eventType}`, [event]);
            if (JSON.stringify(event.payload).length > 20_000)
                add(incidents, 'oversized_payload', 'warning', `Oversized payload on ${event.eventType}`, [event]);
        }
        detectSeq(events, incidents);
        detectRun(events, incidents);
        detectCheckpoint(events, incidents);
        detectGateway(events, incidents);
        detectGui(events, incidents);
        detectLoop(events, incidents, input.projections);
        detectModel(events, incidents);
        detectApproval(events, incidents);
        detectRecovery(events, incidents);
        detectCorruption(events, incidents, input.audit);
        if (input.graph.orphanNodes.length) {
            const orphanEvents = events.filter(event => input.graph.orphanNodes.includes(`event:${event.eventId}`));
            for (const event of orphanEvents.filter(event => isTerminal(event.eventType)))
                add(incidents, 'orphan_terminal_event', 'error', `Terminal event has no causal links: ${event.eventType}`, [event]);
        }
        if (events.length && events.every(event => isLegacy(event)))
            add(incidents, 'legacy_bridge_only', 'warning', 'Replay contains only legacy bridged events.', events.slice(0, 3));
        for (const path of input.redactionSuspects ?? [])
            addRaw(incidents, 'payload_secret_suspected', 'critical', 'Secret-like payload was redacted.', [], { paths: [path] }, 'Inspect redaction paths and rotate exposed credentials if this came from a persisted event.');
        if (projectionMismatch(input.projections))
            addRaw(incidents, 'replay_projection_mismatch', 'warning', 'Projection metrics disagree across core views.', [], {}, 'Inspect report projections and graph edges.');
        return dedupeIncidents(incidents);
    }
}
function detectSeq(events, incidents) {
    let previous = 0;
    for (const event of events) {
        if (previous && event.seq < previous)
            add(incidents, 'event_out_of_order', 'error', `Event seq out of order at ${event.seq}`, [event]);
        if (previous && event.seq > previous + 1)
            add(incidents, 'event_seq_gap', 'warning', `Event seq gap ${previous} -> ${event.seq}`, [event]);
        previous = event.seq;
    }
}
function detectRun(events, incidents) {
    const terminal = events.filter(event => isTerminal(event.eventType));
    if (terminal.length > 1)
        add(incidents, 'duplicate_terminal_event', 'critical', 'Run has duplicate terminal events.', terminal);
    const hasRun = events.some(event => event.eventType.startsWith('run_') || event.runId);
    const hasCheckpoint = events.some(event => event.eventType === 'checkpoint');
    if (hasRun && terminal.length && !hasCheckpoint)
        add(incidents, 'run_without_checkpoint', 'error', 'Terminal run has no checkpoint.', terminal);
}
function detectCheckpoint(events, incidents) {
    const seqs = new Set(events.map(event => event.seq));
    for (const event of events.filter(event => event.eventType === 'checkpoint')) {
        const lastSeq = numberPayload(event.payload, 'lastEventSeq');
        if (lastSeq !== undefined && lastSeq > 0 && !seqs.has(lastSeq))
            add(incidents, 'checkpoint_seq_missing', 'critical', `Checkpoint references missing seq ${lastSeq}.`, [event]);
        const pending = arrayPayload(event.payload, 'pendingExternalEffects');
        if (pending.length)
            add(incidents, 'pending_external_effect', 'error', 'Checkpoint has pending external effects.', [event]);
    }
}
function detectGateway(events, incidents) {
    const failed = events.filter(event => event.eventType === 'gateway_outbound_failed' || event.eventType === 'gateway_command_failed');
    for (const event of failed)
        add(incidents, 'gateway_delivery_failed', 'error', 'Gateway delivery or command failed.', [event]);
    for (const event of events.filter(event => event.eventType === 'gateway_recovery_escalated'))
        add(incidents, 'gateway_retry_exhausted', 'critical', 'Gateway recovery escalated after retry exhaustion.', [event]);
}
function detectGui(events, incidents) {
    for (const event of events.filter(event => event.eventType === 'gui_action_stuck'))
        add(incidents, 'stuck_gui_action', 'error', 'GUI action is stuck.', [event]);
}
function detectLoop(events, incidents, projections) {
    for (const event of events.filter(event => event.eventType === 'loop_blocked'))
        add(incidents, 'loop_blocked', 'error', 'Loop is blocked.', [event]);
    if ((projections.loop.metrics.humanGates ?? 0) > 0 && projections.loop.status === 'waiting')
        addRaw(incidents, 'loop_human_gate_pending', 'warning', 'Loop has pending human gate.', [], projections.loop.importantIds, 'Approve or reject the pending human gate.');
}
function detectModel(events, incidents) {
    for (const event of events.filter(event => event.eventType === 'model_fallback_exhausted'))
        add(incidents, 'model_fallback_exhausted', 'error', 'Model fallback exhausted.', [event]);
    for (const event of events.filter(event => event.eventType === 'model_budget_exceeded'))
        add(incidents, 'model_budget_exceeded', 'error', 'Model budget exceeded.', [event]);
    for (const event of events.filter(event => event.eventType === 'model_rate_limited'))
        add(incidents, 'model_rate_limited', 'warning', 'Model provider is rate limited.', [event]);
}
function detectApproval(events, incidents) {
    const requested = events.filter(event => event.eventType.includes('approval') && event.eventType.includes('requested'));
    const resolved = new Set(events.filter(event => event.eventType.includes('approval') && /resolved|completed|approved|rejected/.test(event.eventType)).map(event => stringPayload(event.payload, 'approvalId')).filter(Boolean));
    for (const event of requested) {
        const approvalId = stringPayload(event.payload, 'approvalId');
        if (approvalId && !resolved.has(approvalId))
            add(incidents, 'approval_expired', 'warning', `Approval ${approvalId} is unresolved.`, [event]);
    }
}
function detectRecovery(events, incidents) {
    for (const event of events.filter(event => event.eventType.includes('recovery'))) {
        const decision = stringPayload(event.payload, 'decision');
        if (decision === 'recoverable_auto' && /gui|gateway|shell|file|mcp/i.test(JSON.stringify(event.payload))) {
            add(incidents, 'unsafe_recovery_attempt', 'critical', 'Recovery decision appears to involve unsafe side effects.', [event]);
        }
    }
}
function detectCorruption(events, incidents, audit) {
    for (const event of events.filter(event => event.eventType === 'run_corruption_detected'))
        add(incidents, 'corruption_detected', 'critical', 'Durable corruption event detected.', [event]);
    const auditRecord = recordPayload(audit);
    const errors = Array.isArray(auditRecord.errors) ? auditRecord.errors : [];
    if (errors.length)
        addRaw(incidents, 'corruption_detected', 'critical', 'Consistency audit reported errors.', [], { auditErrors: errors.map(String).slice(0, 5) }, 'Export a replay bundle and run maintenance repair only after review.');
}
function add(incidents, kind, severity, message, events) {
    addRaw(incidents, kind, severity, titleFor(kind), events.map(event => event.eventId), collectImportantIds(events), operatorAction(kind, severity) ?? message);
}
function addRaw(incidents, kind, severity, title, eventIds, importantIds, operatorAction) {
    incidents.push({ incidentId: stableIncidentId(kind, eventIds, importantIds), kind, severity, title, message: operatorAction, eventIds: [...eventIds], importantIds, operatorAction });
}
function collectImportantIds(events) {
    return {
        runIds: unique(events.map(event => event.runId).filter(isString)),
        loopIds: unique(events.map(event => event.loopId).filter(isString)),
        threadIds: unique(events.map(event => event.threadId).filter(isString)),
        eventIds: events.map(event => event.eventId),
        routeIds: unique(events.map(event => stringPayload(event.payload, 'routeId')).filter(isString)),
        guiActionIds: unique(events.map(event => stringPayload(event.payload, 'guiActionId')).filter(isString)),
        deliveryIds: unique(events.map(event => stringPayload(event.payload, 'deliveryId')).filter(isString)),
    };
}
function operatorAction(kind, severity) {
    if (severity === 'critical')
        return `Manual operator review required for ${kind}.`;
    if (kind === 'model_budget_exceeded')
        return 'Switch model or increase budget after review.';
    if (kind === 'loop_human_gate_pending')
        return 'Approve or reject the pending human gate.';
    if (kind === 'gateway_delivery_failed')
        return 'Open gateway delivery details and retry only after review.';
    return undefined;
}
function titleFor(kind) {
    return kind.replace(/_/g, ' ');
}
function stableIncidentId(kind, eventIds, ids) {
    return `incident_${hash(`${kind}:${eventIds.join(',')}:${JSON.stringify(ids)}`)}`;
}
function dedupeIncidents(incidents) {
    const byId = new Map();
    for (const incident of incidents)
        byId.set(incident.incidentId, incident);
    return [...byId.values()];
}
function unknownEvent(eventType) {
    return !/^(run_|model_|tool_|approval|gui_|loop_|gateway_|replay_|checkpoint$|heartbeat$|run_corruption_detected$)/.test(eventType);
}
function projectionMismatch(projections) {
    return projections.run.status === 'completed' && projections.checkpoint.metrics.checkpoints === 0;
}
function isTerminal(eventType) {
    return eventType === 'run_complete' || eventType === 'run_failed' || eventType === 'run_interrupted';
}
function isLegacy(event) {
    return event.eventType.includes('legacy') || Boolean(stringPayload(event.payload, 'legacyRunId'));
}
function recordPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringPayload(value, key) {
    const item = recordPayload(value)[key];
    return typeof item === 'string' && item.trim() ? item : undefined;
}
function numberPayload(value, key) {
    const item = recordPayload(value)[key];
    return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}
function arrayPayload(value, key) {
    const item = recordPayload(value)[key];
    return Array.isArray(item) ? item : [];
}
function isString(value) {
    return typeof value === 'string' && value.length > 0;
}
function unique(values) {
    return [...new Set(values)];
}
function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
}
