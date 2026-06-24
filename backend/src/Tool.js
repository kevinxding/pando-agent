export function createTextResult(toolUseId, content, ok = true, metadata) {
    return {
        toolUseId,
        ok,
        content,
        isError: !ok,
        ...(metadata ? { metadata } : {}),
    };
}
export function createStructuredErrorResult(toolUseId, error, metadata = {}) {
    const failure = classifyToolFailure(error);
    return createTextResult(toolUseId, failure.message, false, {
        ...failure,
        ...metadata,
    });
}
export function classifyToolFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const systemCode = extractSystemErrorCode(error);
    if (lower.includes('no such tool')) {
        return failure('tool_not_found', 'tool', message);
    }
    if (lower.includes('path is outside workspace')) {
        return failure('path_outside_workspace', 'path_safety', message);
    }
    if (lower.includes('not allowed') || lower.includes('blocked by') || lower.includes('requires approval')) {
        return failure('permission_denied', 'permission', message);
    }
    if (lower.includes('oldtext was not found')) {
        return failure('patch_old_text_not_found', 'edit_conflict', message);
    }
    if (lower.includes('oldtext matched') || lower.includes('provide a unique oldtext')) {
        return failure('patch_ambiguous_match', 'edit_conflict', message);
    }
    if (lower.includes('must be') || lower.includes('must use')) {
        return failure('invalid_input', 'invalid_input', message);
    }
    if (lower.includes('is not a file')) {
        return failure('not_file', 'filesystem', message);
    }
    if (systemCode === 'ENOENT' || lower.includes('no such file') || lower.includes('cannot find')) {
        return failure('not_found', 'filesystem', message);
    }
    if (systemCode === 'EACCES' || systemCode === 'EPERM' || lower.includes('access is denied')) {
        return failure('filesystem_permission_denied', 'filesystem', message);
    }
    return failure('tool_exception', 'unknown', message);
}
function failure(code, category, message) {
    return {
        type: 'tool_failure',
        code,
        category,
        message,
    };
}
function extractSystemErrorCode(error) {
    if (!error || typeof error !== 'object')
        return undefined;
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
export function isToolExecutionUpdate(value) {
    return 'result' in value;
}
export function isAsyncIterable(value) {
    return Boolean(value && typeof value[Symbol.asyncIterator] === 'function');
}
export function toolMatchesName(tool, name) {
    return tool.name === name || tool.name.toLowerCase() === name.toLowerCase();
}
