export class ReplayCausalGraphBuilder {
    build(events) {
        const sorted = [...events].sort((left, right) => left.seq - right.seq);
        const nodes = new Map();
        const edges = [];
        const warnings = [];
        for (const event of sorted) {
            upsert(nodes, eventNode(event));
            for (const node of identityNodes(event)) {
                upsert(nodes, node);
                addEdge(edges, node.nodeId, eventNodeId(event), edgeTypeForNode(node.type), true, 'shared id');
            }
            if (event.parentEventId) {
                const parentId = `event:${event.parentEventId}`;
                if (nodes.has(parentId))
                    addEdge(edges, parentId, eventNodeId(event), 'parent_event', false);
                else
                    warnings.push(`event ${event.seq} parentEventId not found: ${event.parentEventId}`);
            }
            addTypedEdges(event, edges);
        }
        const nodeList = [...nodes.values()];
        const from = new Set(edges.map(edge => edge.from));
        const to = new Set(edges.map(edge => edge.to));
        const roots = nodeList.filter(node => !to.has(node.nodeId)).map(node => node.nodeId);
        const leaves = nodeList.filter(node => !from.has(node.nodeId)).map(node => node.nodeId);
        const orphanNodes = nodeList.filter(node => node.type === 'event' && !to.has(node.nodeId) && !from.has(node.nodeId)).map(node => node.nodeId);
        return { nodes: nodeList, edges: dedupeEdges(edges), roots, leaves, orphanNodes, warnings };
    }
}
function eventNode(event) {
    return {
        nodeId: eventNodeId(event),
        type: 'event',
        label: `${event.seq}. ${event.eventType}`,
        eventId: event.eventId,
        seq: event.seq,
        legacy: isLegacy(event),
        payloadSummary: payloadSummary(event.payload),
    };
}
function identityNodes(event) {
    const payload = recordPayload(event.payload);
    const nodes = [];
    push(nodes, 'run', event.runId ?? stringValue(payload, 'runId'));
    push(nodes, 'thread', event.threadId ?? stringValue(payload, 'threadId'));
    push(nodes, 'loop', event.loopId ?? stringValue(payload, 'loopId'));
    push(nodes, 'goal', event.goalId ?? stringValue(payload, 'goalId'));
    push(nodes, 'task', event.taskId ?? stringValue(payload, 'taskId'));
    push(nodes, 'attempt', stringValue(payload, 'attemptId'));
    push(nodes, 'tool_call', event.toolCallId ?? stringValue(payload, 'toolCallId') ?? stringValue(payload, 'toolUseId'));
    push(nodes, 'gui_action', stringValue(payload, 'guiActionId'));
    push(nodes, 'gateway_inbound', stringValue(payload, 'inboundId'));
    push(nodes, 'gateway_outbound', stringValue(payload, 'deliveryId'));
    push(nodes, 'model_route', stringValue(payload, 'routeId'));
    push(nodes, 'checkpoint', stringValue(payload, 'checkpointId'));
    push(nodes, 'approval', stringValue(payload, 'approvalId'));
    push(nodes, 'command', stringValue(payload, 'commandId'));
    push(nodes, 'recovery', event.eventType.includes('recovery') ? event.eventId : undefined);
    if (isLegacy(event))
        push(nodes, 'legacy', event.eventId);
    return nodes;
}
function addTypedEdges(event, edges) {
    const payload = recordPayload(event.payload);
    const eventId = eventNodeId(event);
    const runId = event.runId ?? stringValue(payload, 'runId');
    const commandId = stringValue(payload, 'commandId');
    const inboundId = stringValue(payload, 'inboundId');
    const attemptId = stringValue(payload, 'attemptId');
    const routeId = stringValue(payload, 'routeId');
    const guiActionId = stringValue(payload, 'guiActionId');
    const checkpointId = stringValue(payload, 'checkpointId');
    const approvalId = stringValue(payload, 'approvalId');
    const deliveryId = stringValue(payload, 'deliveryId');
    if (inboundId && commandId)
        addEdge(edges, `gateway_inbound:${inboundId}`, `command:${commandId}`, 'gateway_to_command', true);
    if (commandId && runId)
        addEdge(edges, `command:${commandId}`, `run:${runId}`, 'command_to_run', true);
    if (attemptId && runId)
        addEdge(edges, `attempt:${attemptId}`, `run:${runId}`, 'attempt_to_run', true);
    if (event.loopId && attemptId)
        addEdge(edges, `loop:${event.loopId}`, `attempt:${attemptId}`, 'loop_to_attempt', true);
    if (runId && routeId)
        addEdge(edges, `run:${runId}`, `model_route:${routeId}`, 'run_to_model', true);
    if (runId && event.toolCallId)
        addEdge(edges, `run:${runId}`, `tool_call:${event.toolCallId}`, 'run_to_tool', true);
    if (event.toolCallId && guiActionId)
        addEdge(edges, `tool_call:${event.toolCallId}`, `gui_action:${guiActionId}`, 'tool_to_gui', true);
    if (guiActionId && checkpointId)
        addEdge(edges, `gui_action:${guiActionId}`, `checkpoint:${checkpointId}`, 'gui_to_checkpoint', true);
    if (routeId && event.eventType === 'model_usage_recorded')
        addEdge(edges, `model_route:${routeId}`, eventId, 'model_to_usage', true);
    if (checkpointId && event.eventType.includes('recovery'))
        addEdge(edges, `checkpoint:${checkpointId}`, eventId, 'checkpoint_to_recovery', true);
    if (approvalId && event.eventType.includes('resolved'))
        addEdge(edges, `approval:${approvalId}`, eventId, 'approval_to_resolution', true);
    if (routeId && event.eventType === 'model_fallback_selected')
        addEdge(edges, eventId, `model_route:${routeId}`, 'fallback_to_model', true);
    if (deliveryId && inboundId)
        addEdge(edges, `gateway_inbound:${inboundId}`, `gateway_outbound:${deliveryId}`, 'gateway_to_command', true);
}
function edgeTypeForNode(type) {
    if (type === 'run')
        return 'same_run';
    if (type === 'thread')
        return 'same_thread';
    if (type === 'legacy')
        return 'legacy_bridge';
    if (type === 'model_route')
        return 'run_to_model';
    if (type === 'tool_call')
        return 'run_to_tool';
    if (type === 'checkpoint')
        return 'gui_to_checkpoint';
    return 'same_run';
}
function upsert(nodes, node) {
    if (!nodes.has(node.nodeId))
        nodes.set(node.nodeId, node);
}
function push(nodes, type, value) {
    if (!value)
        return;
    nodes.push({ nodeId: `${type}:${value}`, type, label: `${type} ${value}`, importantId: value });
}
function addEdge(edges, from, to, type, synthetic, reason) {
    if (from === to)
        return;
    edges.push({ edgeId: `edge_${hash(`${from}:${to}:${type}`)}`, from, to, type, synthetic, reason });
}
function dedupeEdges(edges) {
    const byId = new Map();
    for (const edge of edges)
        byId.set(edge.edgeId, edge);
    return [...byId.values()];
}
function eventNodeId(event) {
    return `event:${event.eventId}`;
}
function isLegacy(event) {
    return event.eventType.includes('legacy') || Boolean(stringValue(recordPayload(event.payload), 'legacyRunId'));
}
function payloadSummary(payload) {
    const record = recordPayload(payload);
    return Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean').slice(0, 12));
}
function recordPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringValue(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
}
