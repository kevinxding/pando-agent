export function compareReports(left, right, input = {}) {
    const differences = [];
    compareNumber('incident count', left.incidents.length, right.incidents.length, differences);
    compareString('status', left.status, right.status, differences);
    compareNumber('checkpoint count', left.projections.checkpoint.metrics.checkpoints ?? 0, right.projections.checkpoint.metrics.checkpoints ?? 0, differences);
    compareNumber('model route count', left.projections.model.metrics.routes ?? 0, right.projections.model.metrics.routes ?? 0, differences);
    compareNumber('GUI action count', left.projections.gui.metrics.guiActions ?? 0, right.projections.gui.metrics.guiActions ?? 0, differences);
    compareNumber('gateway delivery count', left.projections.gateway.metrics.deliveries ?? 0, right.projections.gateway.metrics.deliveries ?? 0, differences);
    if (!input.ignoreFields?.includes('timeline.length'))
        compareNumber('timeline length', left.timeline.length, right.timeline.length, differences);
    return { ok: differences.length === 0, differences };
}
function compareNumber(label, left, right, differences) {
    if (left !== right)
        differences.push(`${label}: ${left} != ${right}`);
}
function compareString(label, left, right, differences) {
    if (left !== right)
        differences.push(`${label}: ${left} != ${right}`);
}
