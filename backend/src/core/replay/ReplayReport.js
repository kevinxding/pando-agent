export class ReplayReport {
    toMarkdown(input) {
        if (isReplayReportV2(input))
            return markdownV2(input);
        return legacyMarkdown(input);
    }
    toJson(report) {
        return report;
    }
    toBundle(report) {
        return {
            manifestVersion: 1,
            reportId: report.metadata.reportId,
            files: ['report.md', 'report.json', 'events.jsonl', 'graph.json', 'artifacts-manifest.json'],
            eventCount: report.metadata.eventCount,
            incidentCount: report.incidents.length,
            generatedAtMs: report.metadata.generatedAtMs,
        };
    }
}
function markdownV2(report) {
    const lines = [
        '# Pando Replay Report',
        '',
        '## Summary',
        '',
        report.summary,
        '',
        '## Scope',
        '',
        `Workspace: ${report.metadata.workspaceId}`,
        `Scope: ${report.query.scope}`,
        `Report: ${report.metadata.reportId}`,
        '',
        '## Status',
        '',
        `Status: ${report.status}`,
        '',
        '## Metrics',
        '',
        ...Object.entries(report.metrics).map(([key, value]) => `- ${key}: ${value}`),
        '',
        '## Incident Summary',
        '',
        ...(report.incidents.length ? report.incidents.map(incident => `- [${incident.severity}] ${incident.kind}: ${incident.title}`) : ['- none']),
        '',
        '## Operator Recommendations',
        '',
        ...(report.recommendations.length ? report.recommendations.map(item => `- ${item.type}: ${item.description}${item.commandHint ? ` (${item.commandHint})` : ''}`) : ['- none']),
        '',
        '## Causal Graph',
        '',
        `Nodes: ${report.causalGraphSummary.nodeCount}`,
        `Edges: ${report.causalGraphSummary.edgeCount}`,
        `Roots: ${report.causalGraphSummary.rootCount}`,
        `Leaves: ${report.causalGraphSummary.leafCount}`,
        `Orphans: ${report.causalGraphSummary.orphanCount}`,
        '',
        projectionSection('Run Projection', report.projections.run),
        projectionSection('Loop Projection', report.projections.loop),
        projectionSection('GUI Timeline', report.projections.gui),
        projectionSection('Gateway Timeline', report.projections.gateway),
        projectionSection('Model Timeline', report.projections.model),
        projectionSection('Tool Timeline', report.projections.tool),
        projectionSection('Checkpoints', report.projections.checkpoint),
        projectionSection('Recovery', report.projections.recovery),
        projectionSection('Audit', { summary: report.audit ? 'audit included' : 'audit unavailable', metrics: {}, warnings: [], errors: [] }),
        '## Timeline',
        '',
        ...report.timeline.map(item => `- ${item.seq}. ${item.category}/${item.eventType} (${new Date(item.createdAtMs).toISOString()})${item.warning ? ` warning=${item.warning}` : ''}`),
        '',
        '## Artifacts',
        '',
        ...(report.artifacts.artifacts.length ? report.artifacts.artifacts.map(item => `- ${item.kind}: ${item.ref} (${item.safeSummary})`) : ['- none']),
        '',
        '## Redaction',
        '',
        `Mode: ${report.redactionSummary.mode}`,
        `Redacted fields: ${report.redactionSummary.redactedFieldCount}`,
        ...(report.redactionSummary.paths.length ? report.redactionSummary.paths.map(path => `- ${path}`) : ['- none']),
        '',
        '## Warnings / Errors',
        '',
        ...(report.warnings.length ? report.warnings.map(warning => `- warning: ${warning}`) : ['- warning: none']),
        ...(report.errors.length ? report.errors.map(error => `- error: ${error}`) : ['- error: none']),
        '',
    ];
    return `${lines.join('\n')}\n`;
}
function projectionSection(title, projection) {
    const lines = [`## ${title}`, '', projection.summary, ''];
    for (const [key, value] of Object.entries(projection.metrics))
        lines.push(`- ${key}: ${value}`);
    for (const warning of projection.warnings)
        lines.push(`- warning: ${warning}`);
    for (const error of projection.errors)
        lines.push(`- error: ${error}`);
    lines.push('');
    return lines.join('\n');
}
function legacyMarkdown(input) {
    const lines = [
        `# ${input.title ?? 'Pando Run Replay'}`,
        '',
        ...(input.runId ? [`Run: ${input.runId}`, ''] : []),
        ...(input.status ? [`Status: ${input.status}`, ''] : []),
        `Total events: ${input.timeline.length}`,
        '',
        ...(input.loopState ? [
            '## Loop Projection',
            '',
            `Loop: ${input.loopState.loopId}`,
            `Goal: ${input.loopState.goalId}`,
            `Status: ${input.loopState.status}`,
            `Tasks: ${input.loopState.tasks.length}`,
            `Attempts: ${input.loopState.attempts.length}`,
            `Pending human gate: ${input.loopState.pendingHumanGateId ?? 'none'}`,
            `Verification: ${input.loopState.verificationSummary ?? 'none'}`,
            `Recovery decision: ${input.loopState.recoveryDecision ?? 'none'}`,
            '',
        ] : []),
        ...simpleTimelineSection('GUI Timeline', input.timeline.filter(item => item.category === 'gui')),
        ...simpleTimelineSection('Gateway Timeline', input.timeline.filter(item => item.category === 'gateway')),
        ...simpleTimelineSection('Model Timeline', input.timeline.filter(item => item.category === 'model')),
        ...(input.recoveryDecision ? ['## Recovery', '', `Decision: ${input.recoveryDecision.decision}`, `Reason: ${input.recoveryDecision.reason}`, ''] : []),
        ...(input.audit ? ['## Audit', '', `OK: ${input.audit.ok ? 'true' : 'false'}`, `Warnings: ${input.audit.warnings.length}`, `Errors: ${input.audit.errors.length}`, ''] : []),
        ...(input.checkpoints?.length ? ['## Checkpoints', '', ...input.checkpoints.map(checkpoint => `- ${checkpoint.checkpointId}: ${checkpoint.status}, lastSeq=${checkpoint.lastEventSeq}`), ''] : []),
        '## Timeline',
        '',
    ];
    for (const item of input.timeline)
        lines.push(`- ${item.seq}. ${item.category}/${item.eventType} (${new Date(item.createdAtMs).toISOString()})`);
    return `${lines.join('\n')}\n`;
}
function simpleTimelineSection(title, items) {
    if (!items.length)
        return [];
    const lines = [`## ${title}`, ''];
    for (const item of items) {
        const payload = recordPayload(item.payload);
        const ids = ['guiActionId', 'routeId', 'inboundId', 'deliveryId', 'commandId', 'loopId', 'runId', 'checkpointId', 'approvalId']
            .map(key => stringValue(payload, key) ? `${key}=${stringValue(payload, key)}` : undefined)
            .filter((value) => Boolean(value))
            .join(' ');
        lines.push(`- ${item.seq}. ${item.eventType}${ids ? ` ${ids}` : ''}`);
    }
    lines.push('');
    return lines;
}
function recordPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function stringValue(record, key) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function isReplayReportV2(value) {
    return 'metadata' in value && 'query' in value && 'projections' in value;
}
