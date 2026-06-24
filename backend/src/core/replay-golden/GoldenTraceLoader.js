import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { validateEventEnvelope } from '../protocol/index.js';
export const GOLDEN_TRACE_FILE_NAMES = [
    'events.jsonl',
    'expected-report-shape.json',
    'expected-incidents.json',
    'expected-graph-summary.json',
    'artifacts-manifest.json',
    'README.md',
];
export function defaultGoldenTraceRoot(cwd = process.cwd()) {
    return resolve(cwd, 'golden-traces');
}
export async function listGoldenTraceDirs(root = defaultGoldenTraceRoot()) {
    const names = await readdir(root);
    const dirs = [];
    for (const name of names) {
        const path = join(root, name);
        if ((await stat(path)).isDirectory())
            dirs.push(path);
    }
    return dirs.sort((left, right) => left.localeCompare(right));
}
export async function loadAllGoldenTraces(root = defaultGoldenTraceRoot(), options = {}) {
    const dirs = await listGoldenTraceDirs(root);
    return Promise.all(dirs.map(dir => loadGoldenTrace(dir, options)));
}
export async function loadGoldenTrace(traceDir, options = {}) {
    const dir = resolve(traceDir);
    const events = parseEventsJsonl(await readRequired(join(dir, 'events.jsonl')));
    const expectedReportShape = await readJson(join(dir, 'expected-report-shape.json'), {}, options);
    const expectedIncidents = await readJson(join(dir, 'expected-incidents.json'), [], options);
    const expectedGraphSummary = await readJson(join(dir, 'expected-graph-summary.json'), {}, options);
    const artifactsManifest = await readJson(join(dir, 'artifacts-manifest.json'), { artifacts: [], warnings: [] }, options);
    const readme = (await readText(join(dir, 'README.md'), '', options)) ?? '';
    return {
        name: basename(dir),
        traceDir: dir,
        events,
        expectedReportShape,
        expectedIncidents,
        expectedGraphSummary,
        artifactsManifest,
        readme,
    };
}
function parseEventsJsonl(content) {
    const events = [];
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (error) {
            throw new Error('Invalid events.jsonl line ' + (index + 1) + ': ' + errorMessage(error));
        }
        validateEventEnvelope(parsed);
        events.push(parsed);
    }
    return events;
}
async function readJson(path, fallback, options) {
    const text = await readText(path, undefined, options);
    if (text === undefined)
        return fallback;
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new Error('Invalid JSON in ' + path + ': ' + errorMessage(error));
    }
}
async function readText(path, fallback, options) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (options.allowMissingExpected && isNotFound(error))
            return fallback;
        throw error;
    }
}
async function readRequired(path) {
    return readFile(path, 'utf8');
}
function isNotFound(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
