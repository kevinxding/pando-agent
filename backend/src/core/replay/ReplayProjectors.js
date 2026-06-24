import { projectLoopState } from '../loop/index.js';
import { EventReplay } from './EventReplay.js';
export function projectAllReplay(events) {
    const timeline = new EventReplay().buildTimeline(events);
    return {
        run: projectRunReplay(events, timeline),
        thread: projectThreadReplay(events, timeline),
        loop: projectLoopReplay(events, timeline),
        gui: projectGuiReplay(events, timeline),
        gateway: projectGatewayReplay(events, timeline),
        model: projectModelReplay(events, timeline),
        checkpoint: projectCheckpointReplay(events, timeline),
        recovery: projectRecoveryReplay(events, timeline),
        approval: projectApprovalReplay(events, timeline),
        tool: projectToolReplay(events, timeline),
    };
}
export function projectRunReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const runEvents = events.filter(event => event.runId || event.eventType.startsWith('run_'));
    const terminals = runEvents.filter(event => ['run_complete', 'run_failed', 'run_interrupted'].includes(event.eventType));
    const started = runEvents.find(event => event.eventType === 'run_start');
    const terminal = terminals[terminals.length - 1];
    const modelRoutes = events.filter(event => event.eventType.startsWith('model_')).map(event => stringPayload(event.payload, 'routeId')).filter(isString);
    const toolCalls = events.filter(event => event.eventType.startsWith('tool_') || event.eventType === 'tool_call' || event.toolCallId).map(event => event.toolCallId ?? stringPayload(event.payload, 'toolCallId')).filter(isString);
    const guiActions = events.filter(event => event.eventType.startsWith('gui_')).map(event => stringPayload(event.payload, 'guiActionId')).filter(isString);
    const checkpoints = events.filter(event => event.eventType === 'checkpoint').map(event => stringPayload(event.payload, 'checkpointId') ?? event.eventId);
    return projection({
        timeline,
        status: statusFromTerminal(terminal?.eventType, started ? 'running' : 'unknown'),
        summary: terminal ? `run ${terminal.eventType}` : started ? 'run is running or incomplete' : 'no run lifecycle found',
        importantIds: { runIds: unique(events.map(event => event.runId).filter(isString)), modelRoutes: unique(modelRoutes), toolCalls: unique(toolCalls), guiActions: unique(guiActions), checkpoints: unique(checkpoints) },
        data: {
            runId: firstString(events.map(event => event.runId)),
            threadId: firstString(events.map(event => event.threadId)),
            status: statusFromTerminal(terminal?.eventType, started ? 'running' : 'unknown'),
            startedAtMs: started?.createdAtMs,
            completedAtMs: terminal?.createdAtMs,
            durationMs: started && terminal ? terminal.createdAtMs - started.createdAtMs : undefined,
            modelRoutes: unique(modelRoutes),
            toolCalls: unique(toolCalls),
            guiActions: unique(guiActions),
            checkpoints: unique(checkpoints),
            terminalEvent: terminal?.eventType,
        },
        metrics: { runs: unique(events.map(event => event.runId).filter(isString)).length, terminalEvents: terminals.length, modelRoutes: unique(modelRoutes).length, guiActions: unique(guiActions).length, checkpoints: unique(checkpoints).length },
        warnings: terminals.length > 1 ? ['run has duplicate terminal events'] : [],
    });
}
export function projectThreadReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const threadIds = unique(events.map(event => event.threadId).filter(isString));
    return projection({ timeline, status: threadIds.length ? 'created' : 'unknown', summary: `${threadIds.length} thread(s) in replay`, importantIds: { threadIds }, data: { threadIds }, metrics: { threads: threadIds.length } });
}
export function projectLoopReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const loopEvents = events.filter(event => event.loopId || event.eventType.startsWith('loop_'));
    if (!loopEvents.length)
        return projection({ timeline: [], status: 'unknown', summary: 'no loop events', importantIds: {}, data: {}, metrics: { loops: 0 } });
    const state = projectLoopState(loopEvents);
    return projection({
        timeline: timeline.filter(item => item.category === 'loop'),
        status: mapLoopStatus(state.status),
        summary: `loop ${state.loopId} ${state.status}`,
        importantIds: { loopIds: [state.loopId], goalIds: [state.goalId], taskIds: state.tasks.map(task => task.taskId), attemptIds: state.attempts.map(attempt => attempt.attemptId), humanGateIds: state.humanGates.map(gate => gate.gateId) },
        data: state,
        metrics: { loops: 1, tasks: state.tasks.length, attempts: state.attempts.length, humanGates: state.humanGates.length, failures: state.failureCount },
        warnings: state.warnings,
    });
}
export function projectGuiReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.startsWith('gui_'));
    const actionIds = unique(items.map(event => stringPayload(event.payload, 'guiActionId')).filter(isString));
    const stuck = items.filter(event => event.eventType === 'gui_action_stuck');
    const failed = items.filter(event => event.eventType === 'gui_action_failed');
    return projection({ timeline: timeline.filter(item => item.category === 'gui'), status: stuck.length || failed.length ? 'failed' : actionIds.length ? 'completed' : 'unknown', summary: `${actionIds.length} GUI action(s), ${stuck.length} stuck`, importantIds: { guiActionIds: actionIds }, data: { guiActionIds: actionIds, stuck: stuck.length, failed: failed.length, latest: summarizeLatest(items) }, metrics: { guiActions: actionIds.length, stuck: stuck.length, failed: failed.length } });
}
export function projectGatewayReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.startsWith('gateway_'));
    const inboundIds = unique(items.map(event => stringPayload(event.payload, 'inboundId')).filter(isString));
    const deliveryIds = unique(items.map(event => stringPayload(event.payload, 'deliveryId')).filter(isString));
    const failed = items.filter(event => event.eventType === 'gateway_outbound_failed' || event.eventType === 'gateway_command_failed');
    return projection({ timeline: timeline.filter(item => item.category === 'gateway'), status: failed.length ? 'failed' : items.length ? 'completed' : 'unknown', summary: `${inboundIds.length} inbound, ${deliveryIds.length} delivery, ${failed.length} failed`, importantIds: { inboundIds, deliveryIds }, data: { inboundIds, deliveryIds, failed: failed.length, latest: summarizeLatest(items) }, metrics: { gatewayEvents: items.length, inbound: inboundIds.length, deliveries: deliveryIds.length, failed: failed.length } });
}
export function projectModelReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.startsWith('model_'));
    const routeIds = unique(items.map(event => stringPayload(event.payload, 'routeId')).filter(isString));
    const budgetExceeded = items.filter(event => event.eventType === 'model_budget_exceeded');
    const rateLimited = items.filter(event => event.eventType === 'model_rate_limited');
    const fallbackExhausted = items.filter(event => event.eventType === 'model_fallback_exhausted');
    return projection({ timeline: timeline.filter(item => item.category === 'model'), status: budgetExceeded.length || fallbackExhausted.length ? 'failed' : rateLimited.length ? 'waiting' : items.length ? 'completed' : 'unknown', summary: `${routeIds.length} model route(s), ${fallbackExhausted.length} fallback exhausted`, importantIds: { routeIds }, data: { routeIds, selected: items.map(modelSelection).filter(Boolean), latest: summarizeLatest(items) }, metrics: { modelEvents: items.length, routes: routeIds.length, budgetExceeded: budgetExceeded.length, rateLimited: rateLimited.length, fallbackExhausted: fallbackExhausted.length } });
}
export function projectCheckpointReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType === 'checkpoint' || event.eventType.includes('checkpoint'));
    const checkpointIds = unique(items.map(event => stringPayload(event.payload, 'checkpointId') ?? event.eventId));
    return projection({ timeline: timeline.filter(item => item.category === 'checkpoint' || item.eventType.includes('checkpoint')), status: checkpointIds.length ? 'completed' : 'unknown', summary: `${checkpointIds.length} checkpoint(s)`, importantIds: { checkpointIds }, data: { checkpointIds, latest: summarizeLatest(items) }, metrics: { checkpoints: checkpointIds.length } });
}
export function projectRecoveryReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.includes('recovery') || stringPayload(event.payload, 'decision'));
    return projection({ timeline: timeline.filter(item => item.eventType.includes('recovery')), status: items.length ? 'completed' : 'unknown', summary: `${items.length} recovery decision event(s)`, importantIds: { recoveryEventIds: items.map(event => event.eventId) }, data: { latest: summarizeLatest(items) }, metrics: { recoveryEvents: items.length } });
}
export function projectApprovalReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.includes('approval') || event.eventType === 'approval');
    const approvalIds = unique(items.map(event => stringPayload(event.payload, 'approvalId')).filter(isString));
    const pending = items.filter(event => event.eventType.includes('requested')).length - items.filter(event => event.eventType.includes('resolved') || event.eventType.includes('completed')).length;
    return projection({ timeline: timeline.filter(item => item.category === 'approval' || item.eventType.includes('approval')), status: pending > 0 ? 'waiting' : items.length ? 'completed' : 'unknown', summary: `${approvalIds.length} approval(s), pending=${Math.max(0, pending)}`, importantIds: { approvalIds }, data: { approvalIds, pending: Math.max(0, pending), latest: summarizeLatest(items) }, metrics: { approvals: approvalIds.length, pending: Math.max(0, pending) } });
}
export function projectToolReplay(events, timeline = new EventReplay().buildTimeline(events)) {
    const items = events.filter(event => event.eventType.startsWith('tool_') || event.eventType === 'tool_call' || event.toolCallId);
    const toolCallIds = unique(items.map(event => event.toolCallId ?? stringPayload(event.payload, 'toolCallId') ?? stringPayload(event.payload, 'toolUseId')).filter(isString));
    const failed = items.filter(event => /failed|error/i.test(event.eventType) || stringPayload(event.payload, 'error'));
    return projection({ timeline: timeline.filter(item => item.category === 'tool'), status: failed.length ? 'failed' : items.length ? 'completed' : 'unknown', summary: `${toolCallIds.length} tool call(s), ${failed.length} failed`, importantIds: { toolCallIds }, data: { toolCallIds, failed: failed.length, latest: summarizeLatest(items) }, metrics: { toolCalls: toolCallIds.length, failed: failed.length } });
}
function projection(input) {
    return { status: input.status, summary: input.summary, importantIds: input.importantIds, timelineItems: input.timeline, warnings: input.warnings ?? [], errors: input.errors ?? [], metrics: input.metrics, data: input.data };
}
function statusFromTerminal(eventType, fallback) {
    if (eventType === 'run_complete')
        return 'completed';
    if (eventType === 'run_failed')
        return 'failed';
    if (eventType === 'run_interrupted')
        return 'interrupted';
    return fallback;
}
function mapLoopStatus(status) {
    if (status === 'completed')
        return 'completed';
    if (status === 'blocked')
        return 'blocked';
    if (status === 'failed')
        return 'failed';
    if (status === 'interrupted')
        return 'interrupted';
    if (status === 'waiting_human')
        return 'waiting';
    if (status === 'running')
        return 'running';
    return 'created';
}
function summarizeLatest(events) {
    const event = [...events].sort((left, right) => right.seq - left.seq)[0];
    if (!event)
        return undefined;
    return { eventId: event.eventId, eventType: event.eventType, seq: event.seq, payload: shallowPayload(event.payload) };
}
function modelSelection(event) {
    const payload = recordPayload(event.payload);
    const routeId = stringPayload(payload, 'routeId');
    const provider = stringPayload(payload, 'selectedProviderId') ?? stringPayload(payload, 'providerId');
    const model = stringPayload(payload, 'selectedModelId') ?? stringPayload(payload, 'modelId');
    return routeId || provider || model ? { routeId, provider, model, eventType: event.eventType } : undefined;
}
function shallowPayload(value) {
    const payload = recordPayload(value);
    return Object.fromEntries(Object.entries(payload).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 12));
}
function recordPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringPayload(value, key) {
    const item = recordPayload(value)[key];
    return typeof item === 'string' && item.trim() ? item : undefined;
}
function isString(value) {
    return typeof value === 'string' && value.length > 0;
}
function firstString(values) {
    return values.find(isString);
}
function unique(values) {
    return [...new Set(values)];
}
