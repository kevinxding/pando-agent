import { errorToolResult, globToRegExp, jsonToolResult, listWorkspaceFiles, optionalBoolean, optionalPositiveInteger, optionalString, readWorkspaceText, requiredString, } from '../shared/index.js';
export const GrepTool = {
    name: 'grep',
    description: 'Search UTF-8 workspace files by text or regular expression.',
    safety: 'read_only',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
            include: { type: 'string' },
            regex: { type: 'boolean' },
            caseSensitive: { type: 'boolean' },
            maxResults: { type: 'integer', minimum: 1 },
            maxFileBytes: { type: 'integer', minimum: 1 },
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
            const include = optionalString(toolUse.input, 'include');
            const regex = optionalBoolean(toolUse.input, 'regex', true);
            const caseSensitive = optionalBoolean(toolUse.input, 'caseSensitive', false);
            const maxResults = optionalPositiveInteger(toolUse.input, 'maxResults', 100);
            const maxFileBytes = optionalPositiveInteger(toolUse.input, 'maxFileBytes', 500_000);
            const matcher = createMatcher(pattern, regex, caseSensitive);
            const includeMatcher = include ? globToRegExp(include) : undefined;
            const results = [];
            const files = await listWorkspaceFiles(context, rootPath, { maxFiles: 5000 });
            for (const file of files) {
                if (results.length >= maxResults)
                    break;
                if (includeMatcher && !includeMatcher.test(file.relativePath))
                    continue;
                const { text } = await readWorkspaceText(file, maxFileBytes);
                const lines = text.split(/\r?\n/);
                for (let index = 0; index < lines.length; index += 1) {
                    if (matcher(lines[index])) {
                        results.push({
                            path: file.relativePath,
                            line: index + 1,
                            text: lines[index],
                        });
                        if (results.length >= maxResults)
                            break;
                    }
                }
            }
            return jsonToolResult(toolUse.id, {
                pattern,
                results,
                count: results.length,
                truncated: results.length >= maxResults,
            });
        }
        catch (error) {
            return errorToolResult(toolUse.id, error);
        }
    },
};
function createMatcher(pattern, regex, caseSensitive) {
    if (regex) {
        const expression = new RegExp(pattern, caseSensitive ? undefined : 'i');
        return value => expression.test(value);
    }
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    return value => (caseSensitive ? value : value.toLowerCase()).includes(needle);
}
