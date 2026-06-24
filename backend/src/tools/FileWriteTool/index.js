import { assertCanWrite, errorToolResult, jsonToolResult, optionalBoolean, requiredString, requiredText, resolveWorkspacePath, writeWorkspaceText, } from '../shared/index.js';
export const FileWriteTool = {
    name: 'file_write',
    description: 'Write a UTF-8 text file inside the current workspace.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            createParents: { type: 'boolean' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
    },
    isConcurrencySafe() {
        return false;
    },
    async execute(toolUse, context) {
        try {
            assertCanWrite(context);
            const path = resolveWorkspacePath(context, requiredString(toolUse.input, 'path'));
            const content = requiredText(toolUse.input, 'content');
            const createParents = optionalBoolean(toolUse.input, 'createParents', true);
            const result = await writeWorkspaceText(path, content, createParents);
            return jsonToolResult(toolUse.id, {
                path: path.relativePath,
                bytes: result.bytes,
            });
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
