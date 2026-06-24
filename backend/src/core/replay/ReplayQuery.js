import { ReplayQueryError } from './ReplayTypes.js';
const SCOPES = new Set([
    'run',
    'thread',
    'loop',
    'goal',
    'gui_action',
    'gateway_inbound',
    'gateway_delivery',
    'model_route',
    'checkpoint',
    'time_range',
    'workspace',
]);
export function normalizeReplayQuery(input) {
    const scope = input.scope;
    if (!scope)
        throw new ReplayQueryError('missing_scope', 'Replay query requires an explicit scope.', input);
    if (!SCOPES.has(scope))
        throw new ReplayQueryError('invalid_scope', `Unknown replay scope: ${String(scope)}`, input);
    const query = {
        workspaceId: input.workspaceId ?? 'default',
        scope,
        id: input.id,
        runId: input.runId,
        threadId: input.threadId,
        loopId: input.loopId,
        goalId: input.goalId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        guiActionId: input.guiActionId,
        gatewayId: input.gatewayId,
        inboundId: input.inboundId,
        deliveryId: input.deliveryId,
        routeId: input.routeId,
        checkpointId: input.checkpointId,
        fromSeq: input.fromSeq,
        toSeq: input.toSeq,
        fromTimeMs: input.fromTimeMs,
        toTimeMs: input.toTimeMs,
        includePayload: input.includePayload ?? 'summary',
        includeArtifacts: input.includeArtifacts ?? false,
        includeLegacy: input.includeLegacy ?? true,
        includeIncidents: input.includeIncidents ?? true,
        followRelated: input.followRelated ?? true,
        followDepth: clampDepth(input.followDepth),
        format: input.format ?? 'markdown',
        redaction: input.redaction ?? 'strict',
        includeAll: input.includeAll ?? false,
        caller: input.caller ?? 'cli',
    };
    applyIdAlias(query);
    validateReplayQuery(query);
    return query;
}
export function validateReplayQuery(query) {
    if (query.scope !== 'workspace' && query.scope !== 'time_range')
        assertScopedId(query);
    if (query.scope === 'workspace') {
        const allowed = query.includeAll && (query.caller === 'test' || query.caller === 'maintenance');
        if (!allowed)
            throw new ReplayQueryError('unbounded_workspace', 'Workspace replay requires includeAll=true and caller=test|maintenance.', query);
    }
    if (query.scope === 'time_range') {
        const hasSeqRange = query.fromSeq !== undefined && query.toSeq !== undefined;
        const hasTimeRange = query.fromTimeMs !== undefined && query.toTimeMs !== undefined;
        if (!hasSeqRange && !hasTimeRange)
            throw new ReplayQueryError('invalid_range', 'time_range replay requires seq or time bounds.', query);
    }
    if (query.fromSeq !== undefined && query.toSeq !== undefined && query.fromSeq > query.toSeq) {
        throw new ReplayQueryError('invalid_range', 'fromSeq must be less than or equal to toSeq.', query);
    }
    if (query.fromTimeMs !== undefined && query.toTimeMs !== undefined && query.fromTimeMs > query.toTimeMs) {
        throw new ReplayQueryError('invalid_range', 'fromTimeMs must be less than or equal to toTimeMs.', query);
    }
    for (const [key, value] of Object.entries(query)) {
        if (key.endsWith('Id') && typeof value === 'string' && !/^[A-Za-z0-9_-]+$/.test(value)) {
            throw new ReplayQueryError('invalid_id', `${key} must be an ASCII id.`, query);
        }
    }
}
function applyIdAlias(query) {
    if (!query.id)
        return;
    switch (query.scope) {
        case 'run':
            query.runId ??= query.id;
            break;
        case 'thread':
            query.threadId ??= query.id;
            break;
        case 'loop':
            query.loopId ??= query.id;
            break;
        case 'goal':
            query.goalId ??= query.id;
            break;
        case 'gui_action':
            query.guiActionId ??= query.id;
            break;
        case 'gateway_inbound':
            query.inboundId ??= query.id;
            break;
        case 'gateway_delivery':
            query.deliveryId ??= query.id;
            break;
        case 'model_route':
            query.routeId ??= query.id;
            break;
        case 'checkpoint':
            query.checkpointId ??= query.id;
            break;
        default: break;
    }
}
function assertScopedId(query) {
    const ok = Boolean(query.runId ||
        query.threadId ||
        query.loopId ||
        query.goalId ||
        query.taskId ||
        query.attemptId ||
        query.guiActionId ||
        query.inboundId ||
        query.deliveryId ||
        query.routeId ||
        query.checkpointId);
    if (!ok)
        throw new ReplayQueryError('missing_id', `Replay scope ${query.scope} requires an id.`, query);
}
function clampDepth(value) {
    if (value === undefined)
        return 3;
    if (!Number.isFinite(value))
        return 3;
    return Math.max(0, Math.min(5, Math.trunc(value)));
}
