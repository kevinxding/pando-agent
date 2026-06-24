import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { requiredString } from '../shared/index.js';
export function createReadMcpResourceTool(getConnections) {
    return {
        name: 'read_mcp_resource',
        description: 'Read one MCP resource by server name and URI.',
        safety: 'read_only',
        platforms: ['all'],
        behavior: { reads: true },
        concurrency: 'safe',
        inputSchema: {
            type: 'object',
            properties: {
                serverName: { type: 'string' },
                uri: { type: 'string' },
            },
            required: ['serverName', 'uri'],
        },
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        async execute(toolUse) {
            try {
                const serverName = requiredString(toolUse.input, 'serverName');
                const uri = requiredString(toolUse.input, 'uri');
                const connection = getConnections().find(item => item.serverName === serverName && item.status === 'connected');
                if (!connection?.client?.readResource)
                    throw new Error(`MCP server is not connected or resource reads are unavailable: ${serverName}`);
                const result = await connection.client.readResource(uri);
                return createTextResult(toolUse.id, formatResource(result), true, { serverName, uri });
            }
            catch (error) {
                return createStructuredErrorResult(toolUse.id, error, { toolName: 'read_mcp_resource' });
            }
        },
    };
}
export const ReadMcpResourceTool = createReadMcpResourceTool(() => []);
function formatResource(result) {
    if (typeof result === 'string')
        return result;
    const contents = result.contents;
    if (Array.isArray(contents)) {
        const text = contents.map(item => {
            if (!item || typeof item !== 'object')
                return '';
            const record = item;
            if (typeof record.text === 'string')
                return record.text;
            return JSON.stringify(record);
        }).filter(Boolean).join('\n');
        if (text)
            return text;
    }
    return JSON.stringify(result, null, 2);
}
