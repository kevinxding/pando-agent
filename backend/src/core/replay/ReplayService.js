import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createProtocolId } from '../protocol/index.js';
import { EventReplay } from './EventReplay.js';
import { ReplayArtifactManifestBuilder } from './ReplayArtifactManifest.js';
import { ReplayCausalGraphBuilder } from './ReplayCausalGraph.js';
import { ReplayEventReader } from './ReplayEventReader.js';
import { ReplayIncidentDetector } from './ReplayIncidentDetector.js';
import { projectAllReplay } from './ReplayProjectors.js';
import { normalizeReplayQuery } from './ReplayQuery.js';
import { ReplayRecommendationEngine } from './ReplayRecommendation.js';
import { ReplayRedactor } from './ReplayRedactor.js';
import { ReplayReport } from './ReplayReport.js';
import { validateGraph, validateProjection } from './ReplayValidator.js';
export class ReplayService {
    durable;
    reader;
    redactor = new ReplayRedactor();
    reportRenderer = new ReplayReport();
    constructor(durable) {
        this.durable = durable;
        this.reader = new ReplayEventReader(durable);
    }
    async buildReport(input) {
        const query = normalizeReplayQuery(input);
        const read = await this.reader.readForQuery(query);
        const redacted = this.redactor.redact(read.events, query.redaction);
        const events = redacted.value;
        const timeline = new EventReplay().buildTimeline(events);
        const graph = new ReplayCausalGraphBuilder().build(events);
        const projections = projectAllReplay(events);
        const audit = await this.tryAudit(query);
        const recovery = await this.tryRecovery(query);
        const checkpoints = await this.tryCheckpoints(query);
        const artifacts = new ReplayArtifactManifestBuilder().build(events);
        const detector = new ReplayIncidentDetector();
        const incidents = query.includeIncidents === false
            ? []
            : detector.detect({ events, graph, projections, audit, recovery, redactionSuspects: redacted.summary.suspectedSecretPaths });
        const recommendations = new ReplayRecommendationEngine().recommend(incidents);
        const validation = mergeValidation(validateProjection(draftReport()), validateGraph(draftReport()));
        const status = incidents.some(incident => incident.severity === 'critical' || incident.severity === 'error') || validation.errors.length ? 'error' : incidents.length || validation.warnings.length ? 'warning' : 'ok';
        const report = {
            metadata: { reportId: createProtocolId('replay'), workspaceId: query.workspaceId, generatedAtMs: Date.now(), eventCount: events.length },
            query,
            summary: summarize(query, events.length, incidents.length),
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
            audit,
            recovery,
            checkpoints,
            artifacts,
            redactionSummary: redacted.summary,
            warnings: [...read.warnings, ...graph.warnings, ...artifacts.warnings, ...validation.warnings],
            errors: validation.errors,
        };
        return report;
        function draftReport() {
            return {
                metadata: { reportId: 'draft', workspaceId: query.workspaceId, generatedAtMs: 0, eventCount: events.length },
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
                audit,
                recovery,
                checkpoints,
                artifacts,
                redactionSummary: redacted.summary,
                warnings: [],
                errors: [],
            };
        }
    }
    async buildMarkdown(query) {
        return this.reportRenderer.toMarkdown(await this.buildReport({ ...query, format: 'markdown' }));
    }
    async buildJson(query) {
        return this.reportRenderer.toJson(await this.buildReport({ ...query, format: 'json' }));
    }
    async exportBundle(query, outputDir) {
        const report = await this.buildReport({ ...query, format: 'bundle' });
        const target = resolve(outputDir);
        await mkdir(target, { recursive: true });
        const markdown = this.reportRenderer.toMarkdown(report);
        const json = JSON.stringify(report, null, 2);
        const eventsJsonl = report.timeline.map(item => JSON.stringify(item)).join('\n') + '\n';
        const graphJson = JSON.stringify(report.graph, null, 2);
        const artifactsJson = JSON.stringify(report.artifacts, null, 2);
        const manifest = this.reportRenderer.toBundle(report);
        const files = [
            ['report.md', markdown],
            ['report.json', json],
            ['events.jsonl', eventsJsonl],
            ['graph.json', graphJson],
            ['artifacts-manifest.json', artifactsJson],
            ['manifest.json', JSON.stringify(manifest, null, 2)],
        ];
        for (const [name, content] of files)
            await writeFile(join(target, name), content, 'utf8');
        return { outputDir: target, manifestPath: join(target, 'manifest.json'), files: files.map(([name]) => join(target, name)), report };
    }
    async detectIncidents(query) {
        return (await this.buildReport(query)).incidents;
    }
    async buildGraph(query) {
        return (await this.buildReport(query)).graph;
    }
    async buildOperatorSummary(query) {
        const report = await this.buildReport(query);
        return { status: report.status, summary: report.summary, topIncidents: report.incidents.slice(0, 5), recommendations: report.recommendations.slice(0, 5) };
    }
    async tryAudit(query) {
        if (!query.runId)
            return undefined;
        try {
            return await this.durable.auditRun(query.runId);
        }
        catch (error) {
            return { ok: false, errors: [errorMessage(error)] };
        }
    }
    async tryRecovery(query) {
        if (!query.runId)
            return undefined;
        try {
            return await this.durable.decideRecovery({ runId: query.runId });
        }
        catch (error) {
            return { decision: 'unknown', reason: errorMessage(error), runId: query.runId, recoverable: false };
        }
    }
    async tryCheckpoints(query) {
        try {
            if (query.runId)
                return await this.durable.readCheckpoints({ runId: query.runId });
            if (query.threadId)
                return await this.durable.readCheckpoints({ threadId: query.threadId });
            return [];
        }
        catch {
            return [];
        }
    }
}
function summarize(query, eventCount, incidentCount) {
    return `Replay ${query.scope} report with ${eventCount} event(s) and ${incidentCount} incident(s).`;
}
function mergeValidation(left, right) {
    return { warnings: [...left.warnings, ...right.warnings], errors: [...left.errors, ...right.errors] };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
