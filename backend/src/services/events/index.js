let eventCounter = 0;
export function createEventRecorder(forward) {
    const events = [];
    return {
        events,
        async emitEvent(event) {
            events.push(event);
            await forward?.(event);
        },
    };
}
export async function emitAgentEvent(context, event) {
    await context?.emitEvent?.(event);
}
export function eventBase(context, type) {
    const goalId = typeof context.metadata?.goalId === 'string' ? context.metadata.goalId : undefined;
    return {
        id: `event-${Date.now()}-${++eventCounter}`,
        type,
        sessionId: context.sessionId,
        runId: context.runId,
        turnId: context.turnId,
        ...(goalId ? { goalId } : {}),
        createdAtMs: Date.now(),
    };
}
export function summarizeToolCalls(toolCalls) {
    return toolCalls.map(toolCall => ({
        id: toolCall.id,
        name: toolCall.name,
        input: redactRecord(toolCall.input),
    }));
}
export function summarizeToolUse(toolUse) {
    return redactRecord(toolUse.input);
}
export function summarizeToolResult(result) {
    return {
        ok: result.ok,
        contentPreview: previewText(result.content),
        metadata: result.metadata,
    };
}
export function previewText(value, maxChars = 2000) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
export function createTerminalEventHandler(output) {
    return event => {
        const line = formatEventForTerminal(event);
        if (line)
            output.write(`${line}\n`);
    };
}
export function formatEventForTerminal(event) {
    switch (event.type) {
        case 'run_started':
            return `run started: ${event.runId}`;
        case 'run_completed':
            return `run completed: ${event.runId} in ${event.durationMs}ms`;
        case 'run_failed':
            return `run failed: ${event.runId}: ${event.message}`;
        case 'turn_started':
            return `turn started: ${event.promptPreview}`;
        case 'context_built':
            return formatContextBuiltEvent(event);
        case 'compaction_started':
            return `compaction started: ${event.reason}, window ${event.windowId}`;
        case 'compaction_completed':
            return `compaction completed: covered ${event.coveredMessageCount} message(s), window ${event.windowId}`;
        case 'compaction_failed':
            return `compaction failed: ${event.message}`;
        case 'preflight_started':
            return `preflight started: ${event.cwd}`;
        case 'preflight_completed':
            return event.ok ? 'preflight completed' : `preflight failed checks: ${event.failedCheckIds.join(', ')}`;
        case 'preflight_failed':
            return `preflight failed: ${event.message}`;
        case 'mcp_server_started':
            return `mcp starting: ${event.serverName}`;
        case 'mcp_server_connected':
            return `mcp connected: ${event.serverName} (${event.toolCount} tool(s))`;
        case 'mcp_server_failed':
            return `mcp failed: ${event.serverName}: ${event.message}`;
        case 'gui_action_started':
            return `gui action: ${event.action}`;
        case 'gui_action_completed':
            return event.ok ? `gui completed: ${event.method}` : `gui failed: ${event.message}`;
        case 'gui_action_failed':
            return `gui failed: ${event.message}`;
        case 'gui_action_verified':
            return event.ok ? 'gui verified' : `gui verification failed: ${event.message ?? 'unknown'}`;
        case 'model_request_started':
            return `model request: ${event.provider}/${event.model} round ${event.round}`;
        case 'model_response_completed':
            return event.toolCalls.length
                ? `model requested ${event.toolCalls.length} tool call(s)`
                : 'model response completed';
        case 'model_retry_scheduled':
            return `model retry: ${event.provider}/${event.model} ${event.category} attempt ${event.nextAttempt} in ${event.delayMs}ms`;
        case 'tool_call_started':
            return `tool started: ${event.toolName}`;
        case 'approval_requested':
            return `approval requested: ${event.toolName} (${event.risk})`;
        case 'approval_completed':
            return event.approved ? `approval granted: ${event.toolName}` : `approval denied: ${event.toolName}`;
        case 'tool_call_completed':
            return event.ok ? `tool completed: ${event.toolName}` : `tool failed: ${event.toolName}`;
        case 'tool_loop_stopped':
            return event.message;
        case 'turn_completed':
            return `turn completed in ${event.durationMs}ms`;
        case 'turn_failed':
            return `turn failed: ${event.message}`;
        case 'agent_message_delta':
        case 'agent_message_completed':
        case 'tool_result':
            return undefined;
    }
}
function formatContextBuiltEvent(event) {
    const base = event.compactionSummaryIncluded
        ? `context built: retained ${event.retainedMessageCount}/${event.sourceMessageCount} message(s), dropped ${event.droppedMessageCount}, compacted ${event.compactedMessageCount}`
        : `context built: retained ${event.retainedMessageCount}/${event.sourceMessageCount} message(s), dropped ${event.droppedMessageCount}`;
    if (!event.tokenBudget?.enabled || event.tokenBudget.estimatedTokensLeft === undefined)
        return base;
    return `${base}, tokens left ${event.tokenBudget.estimatedTokensLeft}`;
}
function redactRecord(input) {
    return JSON.parse(JSON.stringify(input, redactSecrets));
}
function redactSecrets(key, value) {
    const normalized = key.toLowerCase();
    if (normalized.includes('apikey') ||
        normalized.includes('api_key') ||
        normalized.includes('token') ||
        normalized.includes('password') ||
        normalized.includes('secret')) {
        return '<redacted>';
    }
    return value;
}
