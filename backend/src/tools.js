import { toolMatchesName } from './Tool.js';
import { AskUserQuestionTool } from './tools/AskUserQuestionTool/index.js';
import { ShellCommandTool } from './tools/BashTool/index.js';
import { ApplyPatchTool } from './tools/FileEditTool/index.js';
import { FileReadTool } from './tools/FileReadTool/index.js';
import { FileWriteTool } from './tools/FileWriteTool/index.js';
import { GoalTools } from './tools/GoalTool/index.js';
import { GuiTool } from './tools/GuiTool/index.js';
import { GlobTool } from './tools/GlobTool/index.js';
import { GrepTool } from './tools/GrepTool/index.js';
import { createListMcpResourcesTool } from './tools/ListMcpResourcesTool/index.js';
import { LSPTool } from './tools/LSPTool/index.js';
import { NotebookEditTool } from './tools/NotebookEditTool/index.js';
import { PowerShellTool } from './tools/PowerShellTool/index.js';
import { createReadMcpResourceTool } from './tools/ReadMcpResourceTool/index.js';
import { RemoteTriggerTool } from './tools/RemoteTriggerTool/index.js';
import { REPLTool } from './tools/REPLTool/index.js';
import { ScheduleCronTool } from './tools/ScheduleCronTool/index.js';
import { SendMessageTool } from './tools/SendMessageTool/index.js';
import { SkillTool } from './tools/SkillTool/index.js';
import { TaskCreateTool } from './tools/TaskCreateTool/index.js';
import { TaskGetTool } from './tools/TaskGetTool/index.js';
import { TaskListTool } from './tools/TaskListTool/index.js';
import { TaskOutputTool } from './tools/TaskOutputTool/index.js';
import { TaskStopTool } from './tools/TaskStopTool/index.js';
import { TaskUpdateTool } from './tools/TaskUpdateTool/index.js';
import { TodoWriteTool } from './tools/TodoWriteTool/index.js';
import { createToolSearchTool } from './tools/ToolSearchTool/index.js';
import { WebFetchTool } from './tools/WebFetchTool/index.js';
import { WebSearchTool } from './tools/WebSearchTool/index.js';
import { connectConfiguredMcpServers, mcpConnectionsToToolDefinitions, } from './services/mcp/index.js';
export function createToolRegistry(tools) {
    const byName = new Map(tools.map(tool => [tool.name.toLowerCase(), tool]));
    return {
        tools,
        get(name) {
            return byName.get(name.toLowerCase()) ?? findToolByName(tools, name);
        },
        has(name) {
            return Boolean(this.get(name));
        },
        names() {
            return tools.map(tool => tool.name);
        },
    };
}
export function createDefaultToolRegistry() {
    let tools = [];
    tools = [
        FileReadTool,
        GlobTool,
        GrepTool,
        FileWriteTool,
        ApplyPatchTool,
        ShellCommandTool,
        PowerShellTool,
        GuiTool,
        ...GoalTools,
        TodoWriteTool,
        TaskCreateTool,
        TaskListTool,
        TaskGetTool,
        TaskUpdateTool,
        TaskOutputTool,
        TaskStopTool,
        WebFetchTool,
        WebSearchTool,
        LSPTool,
        SkillTool,
        REPLTool,
        createListMcpResourcesTool(() => []),
        createReadMcpResourceTool(() => []),
        AskUserQuestionTool,
        NotebookEditTool,
        ScheduleCronTool,
        RemoteTriggerTool,
        SendMessageTool,
    ];
    tools = [...tools, createToolSearchTool(() => tools)];
    return createToolRegistry(tools);
}
export async function createRuntimeToolRegistry(input = {}) {
    const mcpConnections = input.config ? await connectConfiguredMcpServers(input.config, input.mcp) : [];
    const mcpTools = mcpConnectionsToToolDefinitions(mcpConnections);
    let tools = [
        ...createDefaultToolRegistry().tools.filter(tool => tool.name !== 'list_mcp_resources' && tool.name !== 'read_mcp_resource' && tool.name !== 'tool_search'),
        createListMcpResourcesTool(() => mcpConnections),
        createReadMcpResourceTool(() => mcpConnections),
        ...mcpTools,
    ];
    tools = [...tools, createToolSearchTool(() => tools)];
    return {
        registry: createToolRegistry(tools),
        mcpConnections,
    };
}
export function findToolByName(tools, name) {
    return tools.find(tool => toolMatchesName(tool, name));
}
