import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { optionalString } from '../shared/index.js';
export function createListMcpResourcesTool(getConnections) {
    return {
        name: 'list_mcp_resources',
        description: 'List resources exposed by connected MCP servers.',
        safety: 'read_only',
        platforms: ['all'],
        behavior: { reads: true },
        concurrency: 'safe',
        inputSchema: {
            type: 'object',
            properties: {
                serverName: { type: 'string' },
            },
        },
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        async execute(toolUse) {
            try {
                const serverName = optionalString(toolUse.input, 'serverName');
                const resources = getConnections()
                    .filter(connection => connection.status === 'connected')
                    .filter(connection => !serverName || connection.serverName === serverName)
                    .flatMap(connection => (connection.resources ?? []).map(resource => ({
                    serverName: connection.serverName,
                    ...resource,
                })));
                return createTextResult(toolUse.id, JSON.stringify({ resources, count: resources.length }, null, 2), true, {
                    resourceCount: resources.length,
                });
            }
            catch (error) {
                return createStructuredErrorResult(toolUse.id, error, { toolName: 'list_mcp_resources' });
            }
        },
    };
}
export const ListMcpResourcesTool = createListMcpResourcesTool(() => []);
