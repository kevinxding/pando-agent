import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventReplay, ReplayArtifactManifestBuilder, ReplayCausalGraphBuilder, ReplayIncidentDetector, ReplayRecommendationEngine, ReplayRedactor, normalizeReplayQuery, projectAllReplay, validateGraph, validateProjection, } from '../replay/index.js';
import { compareGoldenTraceReport } from './GoldenTraceDiff.js';
import { loadAllGoldenTraces } from './GoldenTraceLoader.js';
const PROJECTION_KEYS = ['run', 'thread', 'loop', 'gui', 'gateway', 'model', 'checkpoint', 'recovery', 'approval', 'tool'];
const DEFAULT_MARKDOWN_SECTIONS = [
    '## Summary',
    '## Scope',
    '## Status',
    '## Metrics',
    '## Incident Summary',
    '## Operator Recommendations',
    '## Causal Graph',
    '## Run Projection',
    '## Loop Projection',
    '## GUI Timeline',
    '## Gateway Timeline',
    '## Model Timeline',
    '## Tool Timeline',
    '## Checkpoints',
    '## Recovery',
    '## Audit',
    '## Timeline',
    '## Artifacts',
    '## Redaction',
    '## Warnings / Errors',
];
const SECRET_KEY_PATTERN = /api[_-]?key|authorization|bearer|cookie|webhook|token|secret|password|pairing/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{16,}|gho_[A-Za-z0-9_]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|https:\/\/[^\s/]+\/[^\s]*(webhook|hook|bot)[^\s]*)/i;
const CURRENT_TIMESTAMP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export function validateGoldenTrace(trace) {
    const report = buildGoldenTraceReport(trace);
    const deterministic = validateDeterministicTrace(trace);
    const diff = compareGoldenTraceReport(trace, report);
    const errors = [...deterministic.errors, ...diff.differences];
    return {
        traceName: trace.name,
        ok: errors.length === 0,
        errors,
        warnings: deterministic.warnings,
        report,
        diffMarkdown: diff.markdown,
    };
}
export async function validateAllGoldenTraces(root) {
    const traces = await loadAllGoldenTraces(root);
    return traces.map(validateGoldenTrace);
}
export function buildGoldenTraceReport(trace) {
    const query = normalizeReplayQuery(queryForTrace(trace));
    const redacted = new ReplayRedactor().redact(trace.events, query.redaction);
    const events = redacted.value;
    const timeline = new EventReplay().buildTimeline(events);
    const graph = new ReplayCausalGraphBuilder().build(events);
    const projections = projectAllReplay(events);
    const artifacts = new ReplayArtifactManifestBuilder().build(events);
    const detector = new ReplayIncidentDetector();
    const incidents = query.includeIncidents === false
        ? []
        : detector.detect({ events, graph, projections, redactionSuspects: redacted.summary.suspectedSecretPaths });
    const recommendations = new ReplayRecommendationEngine().recommend(incidents);
    const draft = () => ({
        metadata: { reportId: 'replay_golden_' + trace.name, workspaceId: query.workspaceId, generatedAtMs: 0, eventCount: events.length },
        query,
        summary: '',
        status: 'ok',
        metrics: {},
        timeline,
        causalGraphSummary: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, rootCount: graph.roots.length, leafCount: graph.leaves.length, orphanCount: graph.orphanNodes.length },
        graph,
        projections,
        incidents,
        recommendations,
        checkpoints: [],
        artifacts,
        redactionSummary: redacted.summary,
        warnings: [],
        errors: [],
    });
    const validation = mergeValidation(validateProjection(draft()), validateGraph(draft()));
    const status = incidents.some(incident => incident.severity === 'critical' || incident.severity === 'error') || validation.errors.length
        ? 'error'
        : incidents.length || validation.warnings.length
            ? 'warning'
            : 'ok';
    return {
        metadata: { reportId: 'replay_golden_' + trace.name, workspaceId: query.workspaceId, generatedAtMs: 0, eventCount: events.length },
        query,
        summary: 'Replay ' + query.scope + ' report with ' + events.length + ' event(s) and ' + incidents.length + ' incident(s).',
        status,
        metrics: {
            events: events.length,
            timelineItems: timeline.length,
            graphNodes: graph.nodes.length,
            graphEdges: graph.edges.length,
            incidents: incidents.length,
            recommendations: recommendations.length,
        },
        timeline,
        causalGraphSummary: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, rootCount: graph.roots.length, leafCount: graph.leaves.length, orphanCount: graph.orphanNodes.length },
        graph,
        projections,
        incidents,
        recommendations,
        checkpoints: [],
        artifacts,
        redactionSummary: redacted.summary,
        warnings: [...graph.warnings, ...artifacts.warnings, ...validation.warnings],
        errors: validation.errors,
    };
}
export function createGoldenTraceExpectedFiles(trace) {
    const report = buildGoldenTraceReport(trace);
    return [
        { fileName: 'expected-report-shape.json', content: stableJson(expectedReportShapeFromReport(report)) },
        { fileName: 'expected-incidents.json', content: stableJson(expectedIncidentsFromReport(report.incidents)) },
        { fileName: 'expected-graph-summary.json', content: stableJson(expectedGraphSummaryFromReport(report)) },
        { fileName: 'artifacts-manifest.json', content: stableJson(report.artifacts) },
    ];
}
export async function updateGoldenTrace(trace, options = {}) {
    const files = createGoldenTraceExpectedFiles(trace);
    if (options.write === true) {
        for (const file of files)
            await writeFile(join(trace.traceDir, file.fileName), file.content, 'utf8');
    }
    return { traceName: trace.name, traceDir: trace.traceDir, wrote: options.write === true, files };
}
export async function updateAllGoldenTraces(root, options = {}) {
    const traces = await loadAllGoldenTraces(root, { allowMissingExpected: true });
    const results = [];
    for (const trace of traces)
        results.push(await updateGoldenTrace(trace, options));
    return results;
}
function expectedReportShapeFromReport(report) {
    const projections = {};
    for (const key of PROJECTION_KEYS) {
        projections[key] = {
            status: report.projections[key].status,
            metrics: sortNumberRecord(report.projections[key].metrics),
        };
    }
    return {
        query: report.query,
        status: report.status,
        eventCount: report.metadata.eventCount,
        timelineLength: report.timeline.length,
        metrics: sortNumberRecord(report.metrics),
        markdownSections: DEFAULT_MARKDOWN_SECTIONS,
        projections,
        artifactKinds: report.artifacts.artifacts.map(item => item.kind).sort(),
        redaction: {
            redactedFieldCount: report.redactionSummary.redactedFieldCount,
            suspectedSecretPathCount: report.redactionSummary.suspectedSecretPaths.length,
        },
    };
}
function expectedIncidentsFromReport(incidents) {
    return incidents
        .map(incident => ({
        kind: incident.kind,
        severity: incident.severity,
        eventIds: [...incident.eventIds].sort(),
        importantIds: compactIds(incident.importantIds),
    }))
        .sort((left, right) => incidentSortKey(left).localeCompare(incidentSortKey(right)));
}
function expectedGraphSummaryFromReport(report) {
    const edgeTypes = {};
    for (const edge of report.graph.edges)
        edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    return {
        ...report.causalGraphSummary,
        edgeTypes: sortNumberRecord(edgeTypes),
        warnings: [...report.graph.warnings].sort(),
    };
}
function validateDeterministicTrace(trace) {
    const errors = [];
    const warnings = [];
    if (trace.events.length === 0)
        errors.push(trace.name + ': events.jsonl is empty');
    const seenSeq = new Set();
    const seenIds = new Set();
    for (const event of trace.events) {
        if (seenSeq.has(event.seq))
            errors.push(trace.name + ': duplicate event seq ' + event.seq);
        seenSeq.add(event.seq);
        if (seenIds.has(event.eventId))
            errors.push(trace.name + ': duplicate eventId ' + event.eventId);
        seenIds.add(event.eventId);
        if (Date.now() - event.createdAtMs < CURRENT_TIMESTAMP_WINDOW_MS) {
            errors.push(trace.name + ': event ' + event.eventId + ' uses a current timestamp');
        }
        collectSecretProblems(event.payload, trace.name + ':' + event.eventId + '.payload', errors);
    }
    const sorted = [...trace.events].sort((left, right) => left.seq - right.seq);
    for (let index = 0; index < trace.events.length; index += 1) {
        if (trace.events[index] !== sorted[index])
            errors.push(trace.name + ': events.jsonl is not seq sorted');
    }
    return { errors, warnings };
}
function collectSecretProblems(value, path, errors) {
    if (typeof value === 'string') {
        if (SECRET_VALUE_PATTERN.test(value))
            errors.push(path + ' contains a secret-like value');
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectSecretProblems(item, path + '[' + index + ']', errors));
        return;
    }
    for (const [key, item] of Object.entries(value)) {
        const childPath = path + '.' + key;
        if (SECRET_KEY_PATTERN.test(key))
            errors.push(childPath + ' uses a raw auth-like key');
        collectSecretProblems(item, childPath, errors);
    }
}
function queryForTrace(trace) {
    if (trace.expectedReportShape.query)
        return trace.expectedReportShape.query;
    const first = trace.events[0];
    const runId = trace.events.find(event => event.runId)?.runId;
    if (runId)
        return { workspaceId: first.workspaceId, scope: 'run', runId, includeIncidents: true, caller: 'test' };
    return { workspaceId: first.workspaceId, scope: 'workspace', includeAll: true, includeIncidents: true, caller: 'test' };
}
function mergeValidation(left, right) {
    return { warnings: [...left.warnings, ...right.warnings], errors: [...left.errors, ...right.errors] };
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
function incidentSortKey(incident) {
    return incident.kind + ':' + (incident.severity ?? '') + ':' + (incident.eventIds ?? []).join(',');
}
function sortNumberRecord(input) {
    return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}
function stableJson(value) {
    return JSON.stringify(sortJson(value), null, 2) + '\n';
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
