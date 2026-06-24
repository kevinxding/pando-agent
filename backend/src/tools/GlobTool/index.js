import { errorToolResult, globToRegExp, jsonToolResult, listWorkspaceFiles, optionalBoolean, optionalPositiveInteger, optionalString, requiredString, } from '../shared/index.js';
export const GlobTool = {
    name: 'glob',
    description: 'Find workspace files matching a glob pattern. Supports *, ?, and **.',
    safety: 'read_only',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
            maxResults: { type: 'integer', minimum: 1 },
            includeHidden: { type: 'boolean' },
        },
        required: ['pattern'],
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
            const pattern = requiredString(toolUse.input, 'pattern');
            const rootPath = optionalString(toolUse.input, 'path') ?? '.';
            const maxResults = optionalPositiveInteger(toolUse.input, 'maxResults', 200);
            const includeHidden = optionalBoolean(toolUse.input, 'includeHidden', false);
            const matcher = globToRegExp(pattern);
            const files = await listWorkspaceFiles(context, rootPath, {
                maxFiles: Math.max(maxResults * 5, maxResults),
                includeHidden,
            });
            const matches = files
                .map(file => file.relativePath)
                .filter(path => matcher.test(path))
                .slice(0, maxResults);
            return jsonToolResult(toolUse.id, {
                pattern,
                matches,
                count: matches.length,
                truncated: matches.length >= maxResults,
            });
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
