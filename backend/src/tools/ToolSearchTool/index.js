import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { optionalPositiveInteger, requiredString } from '../shared/index.js';
export function createToolSearchTool(getTools) {
    return {
        name: 'tool_search',
        description: 'Discover available Pando tools by name, capability, safety level, platform support, and behavior.',
        safety: 'read_only',
        platforms: ['all'],
        behavior: { reads: true },
        concurrency: 'safe',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1 },
            },
            required: ['query'],
        },
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        async execute(toolUse) {
            try {
                const query = requiredString(toolUse.input, 'query').toLowerCase();
                const limit = optionalPositiveInteger(toolUse.input, 'limit', 10);
                const terms = query.split(/\s+/).filter(Boolean);
                const results = getTools()
                    .filter(tool => tool.name !== 'tool_search')
                    .map(tool => ({ tool, score: scoreTool(tool, terms) }))
                    .filter(result => result.score > 0)
                    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
                    .slice(0, limit)
                    .map(({ tool }) => ({
                    name: tool.name,
                    description: tool.description,
                    safety: tool.safety,
                    platforms: tool.platforms ?? ['all'],
                    behavior: tool.behavior ?? {},
                    concurrency: tool.concurrency ?? (tool.safety === 'read_only' ? 'safe' : 'serial'),
                }));
                return createTextResult(toolUse.id, JSON.stringify({ query, results, count: results.length }, null, 2), true, {
                    resultCount: results.length,
                });
            }
            catch (error) {
                return createStructuredErrorResult(toolUse.id, error, { toolName: 'tool_search' });
            }
        },
    };
}
export const ToolSearchTool = createToolSearchTool(() => []);
function scoreTool(tool, terms) {
    const haystack = [
        tool.name,
        tool.description,
        tool.safety,
        ...(tool.platforms ?? []),
        ...Object.entries(tool.behavior ?? {}).filter(([, enabled]) => enabled).map(([name]) => name),
    ].join(' ').toLowerCase();
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
