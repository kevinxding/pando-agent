const ARTIFACT_KEYS = [
    { pattern: /tool.*result.*ref|resultRef/i, kind: 'tool_result_ref' },
    { pattern: /screenshot.*ref|screenshotRef/i, kind: 'screenshot_ref' },
    { pattern: /observation.*ref|observationId/i, kind: 'observation_ref' },
    { pattern: /diff.*ref|diffRef/i, kind: 'diff_ref' },
    { pattern: /checkpoint.*ref|checkpointId/i, kind: 'checkpoint_ref' },
    { pattern: /thread.*export.*ref/i, kind: 'thread_export_ref' },
    { pattern: /gateway.*raw.*ref|rawRef/i, kind: 'gateway_raw_ref' },
    { pattern: /usageId|model.*usage.*ref/i, kind: 'model_usage_ref' },
    { pattern: /legacy.*ref|legacyRunId/i, kind: 'legacy_ref' },
];
export class ReplayArtifactManifestBuilder {
    build(events) {
        const artifacts = [];
        const warnings = [];
        for (const event of events)
            collectArtifacts(event.payload, event, '$', artifacts);
        const seen = new Set();
        const deduped = artifacts.filter(item => {
            const key = `${item.kind}:${item.sourceEventId}:${item.ref}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        for (const artifact of deduped) {
            if (!artifact.ref) {
                artifact.missing = true;
                warnings.push(`missing artifact ref for ${artifact.kind} from ${artifact.sourceEventId}`);
            }
        }
        return { artifacts: deduped, warnings };
    }
}
function collectArtifacts(value, event, path, artifacts) {
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectArtifacts(item, event, `${path}[${index}]`, artifacts));
        return;
    }
    for (const [key, item] of Object.entries(value)) {
        const match = ARTIFACT_KEYS.find(entry => entry.pattern.test(key));
        if (match && (typeof item === 'string' || typeof item === 'number')) {
            artifacts.push({
                artifactId: stableArtifactId(event.eventId, key, String(item)),
                kind: match.kind,
                sourceEventId: event.eventId,
                ref: String(item),
                safeSummary: `${match.kind} at ${path}.${key}`,
            });
        }
        collectArtifacts(item, event, `${path}.${key}`, artifacts);
    }
}
function stableArtifactId(eventId, key, ref) {
    return `artifact_${hash(`${eventId}:${key}:${ref}`)}`;
}
function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
}
