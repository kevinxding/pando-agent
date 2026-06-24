export function validateProjection(report) {
    const warnings = [];
    const errors = [];
    if (report.timeline.length !== report.metadata.eventCount)
        warnings.push('timeline length differs from metadata eventCount');
    if (report.projections.run.status === 'completed' && report.projections.checkpoint.metrics.checkpoints === 0)
        errors.push('completed run has no checkpoint projection');
    if (report.incidents.some(incident => incident.kind === 'replay_projection_mismatch'))
        warnings.push('projection mismatch incident exists');
    return { ok: errors.length === 0, warnings, errors };
}
export function validateGraph(report) {
    const warnings = [...report.graph.warnings];
    const errors = [];
    const nodeIds = new Set(report.graph.nodes.map(node => node.nodeId));
    for (const edge of report.graph.edges) {
        if (!nodeIds.has(edge.from))
            errors.push(`graph edge missing from node: ${edge.edgeId}`);
        if (!nodeIds.has(edge.to))
            errors.push(`graph edge missing to node: ${edge.edgeId}`);
    }
    return { ok: errors.length === 0, warnings, errors };
}
