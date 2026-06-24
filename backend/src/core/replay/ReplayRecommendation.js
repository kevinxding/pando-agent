export class ReplayRecommendationEngine {
    recommend(incidents) {
        if (!incidents.length) {
            return [recommendation('no_action', 'No action required', 'No replay incidents were detected.', [])];
        }
        const recommendations = [];
        for (const incident of incidents) {
            const type = recommendationType(incident);
            recommendations.push(recommendation(type, title(type), description(type, incident), [incident.incidentId], commandHint(type, incident)));
        }
        return dedupeRecommendations(recommendations);
    }
}
function recommendationType(incident) {
    switch (incident.kind) {
        case 'model_budget_exceeded': return 'increase_budget';
        case 'model_rate_limited':
        case 'model_fallback_exhausted': return 'switch_model';
        case 'loop_human_gate_pending':
        case 'approval_expired': return 'approve_or_reject';
        case 'gateway_delivery_failed': return 'open_gateway_delivery';
        case 'gateway_retry_exhausted': return 'retry_gateway_delivery';
        case 'stuck_gui_action': return 'inspect_gui_action';
        case 'corruption_detected':
        case 'checkpoint_seq_missing': return 'repair_seq_maintenance';
        case 'run_without_checkpoint':
        case 'duplicate_terminal_event':
        case 'orphan_terminal_event': return 'inspect_run';
        case 'loop_blocked': return 'inspect_loop';
        case 'payload_secret_suspected': return 'file_issue';
        default: return incident.severity === 'critical' || incident.severity === 'error' ? 'manual_recover' : 'export_bundle';
    }
}
function recommendation(type, title, description, incidentIds, commandHint) {
    return { recommendationId: `recommendation_${hash(`${type}:${incidentIds.join(',')}:${title}`)}`, type, title, description, incidentIds, commandHint, safeToAutoExecute: false };
}
function title(type) {
    return type.replace(/_/g, ' ');
}
function description(type, incident) {
    if (type === 'repair_seq_maintenance')
        return 'Export a replay bundle first, then run maintenance repair only after operator review.';
    if (type === 'approve_or_reject')
        return 'Inspect the pending approval or human gate and decide manually.';
    if (type === 'switch_model')
        return 'Inspect model route health, budget, and fallback candidates before changing model settings.';
    return incident.operatorAction ?? incident.message;
}
function commandHint(type, incident) {
    const runId = incident.importantIds.runIds?.[0];
    const loopId = incident.importantIds.loopIds?.[0];
    const guiActionId = incident.importantIds.guiActionIds?.[0];
    const deliveryId = incident.importantIds.deliveryIds?.[0];
    if (type === 'inspect_run' && runId)
        return `pando replay run ${runId}`;
    if (type === 'inspect_loop' && loopId)
        return `pando replay loop ${loopId}`;
    if (type === 'inspect_gui_action' && guiActionId)
        return `pando replay gui ${guiActionId}`;
    if (type === 'open_gateway_delivery' && deliveryId)
        return `pando replay gateway ${deliveryId}`;
    if (type === 'export_bundle' && runId)
        return `pando replay export --run ${runId} --out .pandoshare/replay/export-${runId}`;
    return undefined;
}
function dedupeRecommendations(items) {
    const byId = new Map();
    for (const item of items)
        byId.set(item.recommendationId, item);
    return [...byId.values()];
}
function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
}
