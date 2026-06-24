import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
export const DEFAULT_TOOL_RESULT_INLINE_CHAR_LIMIT = 50_000;
export const DEFAULT_TOOL_RESULT_PREVIEW_CHARS = 2_000;
const TOOL_RESULTS_DIR = 'tool-results';
export async function maybeStoreLargeToolResult(result, context, toolName) {
    const options = normalizeOptions(context.toolResultStorage);
    if (!options.enabled)
        return result;
    if (!context.threadId)
        return result;
    if (result.content.length <= options.inlineCharLimit)
        return result;
    const workspaceRoot = resolve(context.cwd);
    const threadId = sanitizePathSegment(context.threadId);
    const storageId = `${sanitizePathSegment(result.toolUseId)}_${Date.now()}_${shortId()}.txt`;
    const relativePath = `.pandoshare/threads/${threadId}/${TOOL_RESULTS_DIR}/${storageId}`;
    const absolutePath = resolve(workspaceRoot, relativePath);
    assertInsideWorkspace(workspaceRoot, absolutePath);
    await mkdir(resolve(workspaceRoot, `.pandoshare/threads/${threadId}/${TOOL_RESULTS_DIR}`), { recursive: true });
    await writeFile(absolutePath, result.content, 'utf8');
    const preview = previewText(result.content, options.previewChars);
    const metadata = {
        stored: true,
        storageId,
        relativePath,
        originalChars: result.content.length,
        previewChars: preview.length,
        inlineCharLimit: options.inlineCharLimit,
    };
    return {
        ...result,
        content: buildStoredResultMessage({
            toolName,
            relativePath,
            originalChars: result.content.length,
            preview,
        }),
        metadata: {
            ...(result.metadata ?? {}),
            toolResultStorage: metadata,
        },
    };
}
function normalizeOptions(options) {
    return {
        enabled: options?.enabled ?? true,
        inlineCharLimit: options?.inlineCharLimit ?? readPositiveIntegerEnv('PANDOSHARE_TOOL_RESULT_INLINE_CHAR_LIMIT', DEFAULT_TOOL_RESULT_INLINE_CHAR_LIMIT),
        previewChars: options?.previewChars ?? readPositiveIntegerEnv('PANDOSHARE_TOOL_RESULT_PREVIEW_CHARS', DEFAULT_TOOL_RESULT_PREVIEW_CHARS),
    };
}
function buildStoredResultMessage(input) {
    return [
        '[persisted tool result]',
        `tool: ${input.toolName}`,
        `originalChars: ${input.originalChars}`,
        `fullOutputPath: ${input.relativePath}`,
        'The full output was stored on disk. Read the path above if the complete output is needed.',
        '',
        `Preview (first ${input.preview.length} chars):`,
        input.preview,
        '[/persisted tool result]',
    ].join('\n');
}
function previewText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
function sanitizePathSegment(value) {
    const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_');
    return sanitized || 'item';
}
function assertInsideWorkspace(workspaceRoot, targetPath) {
    const relativePath = relative(workspaceRoot, targetPath);
    if (relativePath === '')
        return;
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error(`Tool result path is outside workspace: ${targetPath}`);
    }
}
function readPositiveIntegerEnv(key, fallback) {
    const runtime = globalThis;
    const raw = runtime.process?.env?.[key];
    if (!raw)
        return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
function shortId() {
    return Math.random().toString(36).slice(2, 10);
}
