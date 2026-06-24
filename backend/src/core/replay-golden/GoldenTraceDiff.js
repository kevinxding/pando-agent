import { ReplayReport } from '../replay/index.js';
export function compareGoldenTraceReport(trace, report, options = {}) {
    const markdown = options.markdown ?? new ReplayReport().toMarkdown(report);
    const missingSections = missingMarkdownSections(trace, markdown);
    const incidentDiff = diffLines('incident', incidentRows(trace.expectedIncidents), incidentRowsFromReport(report.incidents));
    const graphEdgeDiff = diffGraphEdges(trace, report);
    const projectionStatusDiff = diffProjectionStatus(trace, report);
    const reportShapeDiff = diffReportShape(trace, report);
    const differences = [
        ...missingSections.map(section => 'missing markdown section: ' + section),
        ...incidentDiff,
        ...graphEdgeDiff,
        ...projectionStatusDiff,
        ...reportShapeDiff,
    ];
    return {
        ok: differences.length === 0,
        differences,
        markdown: renderDiffMarkdown(trace.name, {
            missingSections,
            incidentDiff,
            graphEdgeDiff,
            projectionStatusDiff,
            reportShapeDiff,
        }),
    };
}
function missingMarkdownSections(trace, markdown) {
    return (trace.expectedReportShape.markdownSections ?? []).filter(section => !markdown.includes(section));
}
function diffGraphEdges(trace, report) {
    const differences = [];
    const expected = trace.expectedGraphSummary;
    if (expected.edgeCount !== undefined && expected.edgeCount !== report.graph.edges.length) {
        differences.push('edgeCount expected ' + expected.edgeCount + ' actual ' + report.graph.edges.length);
    }
    if (expected.nodeCount !== undefined && expected.nodeCount !== report.graph.nodes.length) {
        differences.push('nodeCount expected ' + expected.nodeCount + ' actual ' + report.graph.nodes.length);
    }
    differences.push(...diffNumberMap('edge type', expected.edgeTypes ?? {}, edgeTypeCounts(report)));
    return differences;
}
function diffProjectionStatus(trace, report) {
    const differences = [];
    const expected = trace.expectedReportShape.projections ?? {};
    for (const key of Object.keys(expected)) {
        const expectedStatus = expected[key]?.status;
        if (!expectedStatus)
            continue;
        const actualStatus = report.projections[key].status;
        if (expectedStatus !== actualStatus) {
            differences.push(String(key) + ' projection status expected ' + expectedStatus + ' actual ' + actualStatus);
        }
    }
    return differences;
}
function diffReportShape(trace, report) {
    const differences = [];
    const expected = trace.expectedReportShape;
    if (expected.status !== undefined && expected.status !== report.status)
        differences.push('status expected ' + expected.status + ' actual ' + report.status);
    if (expected.eventCount !== undefined && expected.eventCount !== report.metadata.eventCount)
        differences.push('eventCount expected ' + expected.eventCount + ' actual ' + report.metadata.eventCount);
    if (expected.timelineLength !== undefined && expected.timelineLength !== report.timeline.length)
        differences.push('timelineLength expected ' + expected.timelineLength + ' actual ' + report.timeline.length);
    differences.push(...diffNumberMap('metric', expected.metrics ?? {}, report.metrics));
    const expectedKinds = [...(expected.artifactKinds ?? [])].sort();
    if (expectedKinds.length) {
        const actualKinds = report.artifacts.artifacts.map(item => item.kind).sort();
        differences.push(...diffLines('artifact kind', expectedKinds, actualKinds));
    }
    const redaction = expected.redaction;
    if (redaction?.redactedFieldCount !== undefined && redaction.redactedFieldCount !== report.redactionSummary.redactedFieldCount) {
        differences.push('redactedFieldCount expected ' + redaction.redactedFieldCount + ' actual ' + report.redactionSummary.redactedFieldCount);
    }
    if (redaction?.suspectedSecretPathCount !== undefined && redaction.suspectedSecretPathCount !== report.redactionSummary.suspectedSecretPaths.length) {
        differences.push('suspectedSecretPathCount expected ' + redaction.suspectedSecretPathCount + ' actual ' + report.redactionSummary.suspectedSecretPaths.length);
    }
    const projections = expected.projections ?? {};
    for (const key of Object.keys(projections)) {
        differences.push(...diffNumberMap(String(key) + ' projection metric', projections[key]?.metrics ?? {}, report.projections[key].metrics));
    }
    return differences;
}
function edgeTypeCounts(report) {
    const counts = {};
    for (const edge of report.graph.edges)
        counts[edge.type] = (counts[edge.type] ?? 0) + 1;
    return sortRecord(counts);
}
function incidentRows(expected) {
    return expected.map(item => normalizeJsonLine({
        kind: item.kind,
        severity: item.severity,
        eventIds: item.eventIds ?? [],
        importantIds: compactIds(item.importantIds ?? {}),
    })).sort();
}
function incidentRowsFromReport(incidents) {
    return incidents.map(item => normalizeJsonLine({
        kind: item.kind,
        severity: item.severity,
        eventIds: item.eventIds,
        importantIds: compactIds(item.importantIds),
    })).sort();
}
function diffNumberMap(label, expected, actual) {
    const differences = [];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
        const left = expected[key] ?? 0;
        const right = actual[key] ?? 0;
        if (left !== right)
            differences.push(label + ' ' + key + ' expected ' + left + ' actual ' + right);
    }
    return differences;
}
function diffLines(label, expected, actual) {
    const differences = [];
    const expectedCounts = countLines(expected);
    const actualCounts = countLines(actual);
    const keys = [...new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)])].sort();
    for (const key of keys) {
        const left = expectedCounts[key] ?? 0;
        const right = actualCounts[key] ?? 0;
        if (left !== right)
            differences.push(label + ' ' + key + ' expected ' + left + ' actual ' + right);
    }
    return differences;
}
function countLines(lines) {
    const counts = {};
    for (const line of lines)
        counts[line] = (counts[line] ?? 0) + 1;
    return counts;
}
function renderDiffMarkdown(traceName, sections) {
    const lines = [
        '# Golden Trace Diff: ' + traceName,
        '',
        '## Missing Section',
        '',
        ...linesOrNone(sections.missingSections),
        '',
        '## Incident Diff',
        '',
        ...linesOrNone(sections.incidentDiff),
        '',
        '## Graph Edge Diff',
        '',
        ...linesOrNone(sections.graphEdgeDiff),
        '',
        '## Projection Status Diff',
        '',
        ...linesOrNone(sections.projectionStatusDiff),
        '',
        '## Report Shape Diff',
        '',
        ...linesOrNone(sections.reportShapeDiff),
        '',
    ];
    return lines.join('\n');
}
function linesOrNone(lines) {
    return lines.length ? lines.map(line => '- ' + line) : ['- none'];
}
function compactIds(ids) {
    const out = {};
    for (const key of Object.keys(ids).sort()) {
        const values = [...new Set(ids[key] ?? [])].sort();
        if (values.length)
            out[key] = values;
    }
    return out;
}
function normalizeJsonLine(value) {
    return JSON.stringify(sortJson(value));
}
function sortRecord(input) {
    return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}
function sortJson(value) {
    if (Array.isArray(value))
        return value.map(sortJson);
    if (!value || typeof value !== 'object')
        return value;
    const out = {};
    for (const key of Object.keys(value).sort())
        out[key] = sortJson(value[key]);
    return out;
}
