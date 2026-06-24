import { assertCanWrite, errorToolResult, jsonToolResult, optionalBoolean, readWorkspaceText, requiredString, requiredText, resolveWorkspacePath, writeWorkspaceText, } from '../shared/index.js';
export const ApplyPatchTool = {
    name: 'apply_patch',
    description: 'Apply an exact text replacement to one UTF-8 workspace file. oldText must match unless createIfMissing is true.',
    safety: 'workspace_write',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
            replaceAll: { type: 'boolean' },
            createIfMissing: { type: 'boolean' },
        },
        required: ['path', 'oldText', 'newText'],
        additionalProperties: false,
    },
    isConcurrencySafe() {
        return false;
    },
    async execute(toolUse, context) {
        try {
            assertCanWrite(context);
            const path = resolveWorkspacePath(context, requiredString(toolUse.input, 'path'));
            const oldText = requiredText(toolUse.input, 'oldText');
            const newText = requiredText(toolUse.input, 'newText');
            const replaceAll = optionalBoolean(toolUse.input, 'replaceAll', false);
            const createIfMissing = optionalBoolean(toolUse.input, 'createIfMissing', false);
            let original = '';
            try {
                original = (await readWorkspaceText(path, 5_000_000)).text;
            }
            catch (error) {
                if (!createIfMissing)
                    throw error;
            }
            if (createIfMissing && original === '' && oldText === '') {
                const written = await writeWorkspaceText(path, newText, true);
                return jsonToolResult(toolUse.id, {
                    path: path.relativePath,
                    replacements: 1,
                    bytes: written.bytes,
                    created: true,
                });
            }
            if (!oldText)
                throw new Error('oldText must not be empty unless createIfMissing is true');
            const matches = countOccurrences(original, oldText);
            if (matches === 0)
                throw new Error(`oldText was not found in ${path.relativePath}`);
            if (!replaceAll && matches > 1) {
                throw new Error(`oldText matched ${matches} times in ${path.relativePath}; set replaceAll=true or provide a unique oldText`);
            }
            const updated = replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText);
            const written = await writeWorkspaceText(path, updated, true);
            return jsonToolResult(toolUse.id, {
                path: path.relativePath,
                replacements: replaceAll ? matches : 1,
                bytes: written.bytes,
                created: false,
            });
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
export const FileEditTool = ApplyPatchTool;
function countOccurrences(value, needle) {
    if (!needle)
        return 0;
    let count = 0;
    let index = 0;
    while (true) {
        const found = value.indexOf(needle, index);
        if (found === -1)
            return count;
        count += 1;
        index = found + needle.length;
    }
}
