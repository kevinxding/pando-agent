import { createTextResult } from '../../Tool.js';
import { assertCanRunExternal, errorToolResult, optionalPositiveInteger, optionalString, powerShellCommand, processResultMetadata, processResultContent, requiredString, resolveWorkspaceCwd, runProcess, } from '../shared/index.js';
export const PowerShellTool = {
    name: 'powershell_command',
    description: 'Run a PowerShell command with workspace-bounded cwd, timeout, hidden window, and captured output.',
    safety: 'external_write',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeoutMs: { type: 'integer', minimum: 1 },
            maxOutputChars: { type: 'integer', minimum: 1 },
        },
        required: ['command'],
        additionalProperties: false,
    },
    isConcurrencySafe() {
        return false;
    },
    async execute(toolUse, context) {
        try {
            assertCanRunExternal(context);
            const commandText = requiredString(toolUse.input, 'command');
            const cwd = resolveWorkspaceCwd(context, optionalString(toolUse.input, 'cwd'));
            const timeoutMs = optionalPositiveInteger(toolUse.input, 'timeoutMs', 30_000);
            const maxOutputChars = optionalPositiveInteger(toolUse.input, 'maxOutputChars', 20_000);
            const command = powerShellCommand(commandText);
            const result = await runProcess({
                command: command.command,
                args: command.args,
                cwd: cwd.absolutePath,
                timeoutMs,
                maxOutputChars,
                abortSignal: context.abortSignal,
            });
            return createTextResult(toolUse.id, processResultContent(result), result.exitCode === 0 && !result.timedOut, processResultMetadata(result));
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
