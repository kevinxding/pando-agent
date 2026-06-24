import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { runLspAction } from '../../services/lsp/index.js';
import { optionalPositiveInteger, optionalString, requiredString } from '../shared/index.js';
export const LSPTool = {
    name: 'lsp',
    description: 'Run lightweight code-intelligence queries: diagnostics, symbols, definitions, and references.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['diagnostics', 'symbols', 'definition', 'references'] },
            path: { type: 'string' },
            symbol: { type: 'string' },
            pattern: { type: 'string' },
            maxResults: { type: 'integer', minimum: 1 },
            timeoutMs: { type: 'integer', minimum: 1 },
        },
        required: ['action'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse, context) {
        try {
            const result = await runLspAction(context, {
                action: parseAction(requiredString(toolUse.input, 'action')),
                path: optionalString(toolUse.input, 'path'),
                symbol: optionalString(toolUse.input, 'symbol'),
                pattern: optionalString(toolUse.input, 'pattern'),
                maxResults: optionalPositiveInteger(toolUse.input, 'maxResults', 100),
                timeoutMs: optionalPositiveInteger(toolUse.input, 'timeoutMs', 30_000),
            });
            return createTextResult(toolUse.id, JSON.stringify(result, null, 2), result.ok, {
                action: result.action,
                itemCount: result.items.length,
                unsupported: result.unsupported,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'lsp' });
        }
    },
};
function parseAction(value) {
    if (value === 'diagnostics' || value === 'symbols' || value === 'definition' || value === 'references')
        return value;
    throw new Error('action must be diagnostics, symbols, definition, or references');
}
