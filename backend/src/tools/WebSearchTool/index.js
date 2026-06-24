import { readFile } from 'node:fs/promises';
import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { limitedText, optionalPositiveInteger, requiredString } from '../shared/index.js';
export const WebSearchTool = {
    name: 'web_search',
    description: 'Search the web through a pluggable backend, returning URL citations and truncated summaries.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true, network: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            maxResults: { type: 'integer', minimum: 1 },
            timeoutMs: { type: 'integer', minimum: 1 },
            maxSnippetChars: { type: 'integer', minimum: 1 },
        },
        required: ['query'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse) {
        try {
            const query = requiredString(toolUse.input, 'query');
            const maxResults = optionalPositiveInteger(toolUse.input, 'maxResults', 5);
            const maxSnippetChars = optionalPositiveInteger(toolUse.input, 'maxSnippetChars', 500);
            const timeoutMs = optionalPositiveInteger(toolUse.input, 'timeoutMs', 20_000);
            const results = await search(query, timeoutMs);
            const selected = results.slice(0, maxResults).map(result => ({
                ...result,
                snippet: result.snippet ? limitedText(result.snippet, maxSnippetChars).text : undefined,
            }));
            return createTextResult(toolUse.id, JSON.stringify({ query, results: selected, citations: selected.map(item => item.url) }, null, 2), true, {
                query,
                resultCount: selected.length,
                citations: selected.map(item => item.url),
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'web_search' });
        }
    },
};
async function search(query, timeoutMs) {
    const env = runtimeEnv();
    const fixtureJson = env.PANDO_WEB_SEARCH_FIXTURES;
    if (fixtureJson)
        return filterFixtureResults(parseResults(JSON.parse(fixtureJson)), query);
    const fixtureFile = env.PANDO_WEB_SEARCH_FIXTURE_FILE;
    if (fixtureFile)
        return filterFixtureResults(parseResults(JSON.parse(await readFile(fixtureFile, 'utf8'))), query);
    const endpoint = env.PANDO_WEB_SEARCH_ENDPOINT;
    if (!endpoint) {
        throw new Error('web_search backend is not configured; set PANDO_WEB_SEARCH_ENDPOINT or PANDO_WEB_SEARCH_FIXTURES');
    }
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
            throw new Error(`web_search backend failed: HTTP ${response.status}`);
        return parseResults(await response.json());
    }
    finally {
        clearTimeout(timeout);
    }
}
function runtimeEnv() {
    const runtime = globalThis;
    return runtime.process?.env ?? {};
}
function filterFixtureResults(results, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length)
        return results;
    const filtered = results.filter(result => {
        const text = `${result.title} ${result.url} ${result.snippet ?? ''}`.toLowerCase();
        return terms.some(term => text.includes(term));
    });
    return filtered.length ? filtered : results;
}
function parseResults(value) {
    const raw = Array.isArray(value)
        ? value
        : value && typeof value === 'object' && Array.isArray(value.results)
            ? value.results
            : [];
    return raw.flatMap(item => {
        if (!item || typeof item !== 'object')
            return [];
        const record = item;
        if (typeof record.url !== 'string' || typeof record.title !== 'string')
            return [];
        return [{
                title: record.title,
                url: record.url,
                snippet: typeof record.snippet === 'string' ? record.snippet : undefined,
            }];
    });
}
