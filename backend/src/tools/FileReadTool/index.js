import { errorToolResult, jsonToolResult, optionalNonNegativeInteger, optionalPositiveInteger, readWorkspaceText, requiredString, resolveWorkspacePath, } from '../shared/index.js';
export const FileReadTool = {
    name: 'file_read',
    description: 'Read a UTF-8 text file from inside the current workspace.',
    safety: 'read_only',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            startLine: { type: 'integer', minimum: 1 },
            maxLines: { type: 'integer', minimum: 1 },
            maxBytes: { type: 'integer', minimum: 1 },
        },
        required: ['path'],
        additionalProperties: false,
    },
    isReadOnly() {
        return true;
    },
    isConcurrencySafe() {
        return true;
    },
    async execute(toolUse, context) {
        try {
            const path = resolveWorkspacePath(context, requiredString(toolUse.input, 'path'));
            const maxBytes = optionalPositiveInteger(toolUse.input, 'maxBytes', 200_000);
            const startLine = optionalPositiveInteger(toolUse.input, 'startLine', 1);
            const maxLines = optionalNonNegativeInteger(toolUse.input, 'maxLines', 0);
            const { text, truncated } = await readWorkspaceText(path, maxBytes);
            const lines = text.split(/\r?\n/);
            const selected = maxLines > 0 ? lines.slice(startLine - 1, startLine - 1 + maxLines) : lines.slice(startLine - 1);
            return jsonToolResult(toolUse.id, {
                path: path.relativePath,
                startLine,
                endLine: startLine + selected.length - 1,
                truncated,
                content: selected.join('\n'),
            });
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
