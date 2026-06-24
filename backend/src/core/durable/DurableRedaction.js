const SECRET_KEY_PATTERN = /(api[_-]?key|token|password|secret|cookie|authorization)/i;
export function redactDurablePayload(value) {
    if (value === undefined)
        return value;
    return JSON.parse(JSON.stringify(value, redactSecrets));
}
function redactSecrets(key, value) {
    if (SECRET_KEY_PATTERN.test(key))
        return '<redacted>';
    if (typeof value === 'string' && looksLikeSecret(value))
        return '<redacted>';
    return value;
}
function looksLikeSecret(value) {
    return /sk-[A-Za-z0-9_-]{16,}/.test(value) || /Bearer\s+[A-Za-z0-9._-]{16,}/i.test(value);
}
