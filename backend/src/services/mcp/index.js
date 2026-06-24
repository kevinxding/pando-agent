import { createTextResult } from '../../Tool.js';
import { eventBase } from '../events/index.js';
import { StdioMcpClient } from './client.js';
export * from './client.js';
export * from './types.js';
export async function connectConfiguredMcpServers(config, options = {}) {
    const servers = config.mcpServers ?? {};
    const connections = [];
    for (const [serverName, serverConfig] of Object.entries(servers)) {
        await options.emitEvent?.({
            ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_started'),
            type: 'mcp_server_started',
            serverName,
            command: serverConfig.command,
        });
        const client = new StdioMcpClient(serverName, serverConfig);
        try {
            const serverInfo = await client.connect();
            const tools = await client.listTools();
            const resources = await safeListResources(client);
            connections.push({
                serverName,
                status: 'connected',
                serverInfo,
                tools,
                resources,
                client,
            });
            await options.emitEvent?.({
                ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_connected'),
                type: 'mcp_server_connected',
                serverName,
                toolCount: tools.length,
                serverInfo,
            });
        }
        catch (error) {
            const message = errorMessage(error);
            client.close();
            connections.push({
                serverName,
                status: 'failed',
                tools: [],
                error: message,
            });
            await options.emitEvent?.({
                ...eventBase({ sessionId: options.sessionId ?? 'mcp' }, 'mcp_server_failed'),
                type: 'mcp_server_failed',
                serverName,
                message,
            });
        }
    }
    return connections;
}
export function closeMcpConnections(connections) {
    for (const connection of connections) {
        connection.client?.close();
    }
}
export function mcpConnectionsToToolDefinitions(connections) {
    return connections.flatMap(connection => {
        const client = connection.client;
        if (connection.status !== 'connected' || !client)
            return [];
        return connection.tools.map(tool => createMcpToolDefinition(connection.serverName, tool, client));
    });
}
export function summarizeMcpConnections(connections) {
    return connections.map(connection => ({
        serverName: connection.serverName,
        status: connection.status,
        serverInfo: connection.serverInfo,
        toolCount: connection.tools.length,
        tools: connection.tools,
        resourceCount: connection.resources?.length ?? 0,
        resources: connection.resources ?? [],
        error: connection.error,
    }));
}
export function formatMcpReport(connections) {
    if (!connections.length)
        return 'No MCP servers configured.\n';
    const lines = [];
    for (const connection of connections) {
        lines.push(`${connection.status === 'connected' ? 'PASS' : 'FAIL'} ${connection.serverName}`);
        if (connection.serverInfo?.name || connection.serverInfo?.version) {
            lines.push(`  server: ${connection.serverInfo.name ?? 'unknown'} ${connection.serverInfo.version ?? ''}`.trimEnd());
        }
        if (connection.error)
            lines.push(`  error: ${connection.error}`);
        if (connection.tools.length)
            lines.push(`  tools: ${connection.tools.map(tool => tool.name).join(', ')}`);
    }
    lines.push('');
    return lines.join('\n');
}
async function safeListResources(client) {
    try {
        return await client.listResources();
    }
    catch {
        return [];
    }
}
function createMcpToolDefinition(serverName, tool, client) {
    return {
        name: `mcp__${sanitizeToolName(serverName)}__${sanitizeToolName(tool.name)}`,
        description: tool.description ?? `MCP tool ${tool.name} from ${serverName}.`,
        safety: 'external_write',
        inputSchema: tool.inputSchema,
        async execute(toolUse) {
            const result = await client.callTool(tool.name, toolUse.input);
            return createTextResult(toolUse.id, formatMcpToolResult(result));
        },
    };
}
function formatMcpToolResult(result) {
    const content = result.content;
    if (Array.isArray(content)) {
        const text = content
            .map(item => {
            if (!item || typeof item !== 'object')
                return undefined;
            const record = item;
            if (record.type === 'text' && typeof record.text === 'string')
                return record.text;
            return JSON.stringify(record);
        })
            .filter((item) => Boolean(item))
            .join('\n');
        if (text)
            return text;
    }
    if (typeof result === 'string')
        return result;
    return JSON.stringify(result, null, 2);
}
function sanitizeToolName(value) {
    const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_');
    return sanitized || 'tool';
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
