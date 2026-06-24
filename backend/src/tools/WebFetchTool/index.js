import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { limitedText, optionalPositiveInteger, requiredString } from '../shared/index.js';
export const WebFetchTool = {
    name: 'web_fetch',
    description: 'Fetch an HTTP/HTTPS URL with timeout handling, content truncation, and source URL metadata.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true, network: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string' },
            timeoutMs: { type: 'integer', minimum: 1 },
            maxChars: { type: 'integer', minimum: 1 },
        },
        required: ['url'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse) {
        try {
            const url = new URL(requiredString(toolUse.input, 'url'));
            if (url.protocol !== 'http:' && url.protocol !== 'https:')
                throw new Error('url must use http or https');
            const timeoutMs = optionalPositiveInteger(toolUse.input, 'timeoutMs', 20_000);
            const maxChars = optionalPositiveInteger(toolUse.input, 'maxChars', 20_000);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: { 'User-Agent': 'PandoAgent/0.1' },
                });
                const text = await response.text();
                const limited = limitedText(text, maxChars);
                return createTextResult(toolUse.id, limited.text, response.ok, {
                    url: url.toString(),
                    status: response.status,
                    contentType: response.headers.get('content-type') ?? undefined,
                    truncated: limited.truncated,
                    sourceUrl: url.toString(),
                });
            }
            finally {
                clearTimeout(timeout);
            }
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error instanceof Error && error.name === 'AbortError' ? 'web_fetch timed out' : error, {
                toolName: 'web_fetch',
            });
        }
    },
};
