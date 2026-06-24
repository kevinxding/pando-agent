export function readEnv(names) {
    const env = globalThis.process?.env;
    for (const name of names) {
        const value = env?.[name]?.trim();
        if (value)
            return { value, key: name };
    }
    return {};
}
export function resolveAuth(auth, requireAuth = true) {
    if (auth.type === 'none') {
        return { headers: {}, redactedHeaders: {} };
    }
    const token = auth.token?.trim() || readEnv(auth.envKeys).value;
    const tokenSource = auth.token?.trim() ? 'inline-token' : readEnv(auth.envKeys).key;
    if (!token) {
        if (requireAuth) {
            throw new Error(`Missing auth token. Set one of: ${auth.envKeys.join(', ')}`);
        }
        return {
            headers: {},
            redactedHeaders: {},
            missingEnv: auth.envKeys,
        };
    }
    const headers = {
        Authorization: `Bearer ${token}`,
    };
    if (auth.type === 'codex-access-token') {
        const accountId = auth.accountId?.trim() || readEnv(auth.accountIdEnvKeys ?? []).value;
        if (accountId) {
            headers['ChatGPT-Account-ID'] = accountId;
        }
    }
    return {
        headers,
        redactedHeaders: redactHeaders(headers),
        source: tokenSource,
    };
}
export function resolveEnvHeaders(configs) {
    const headers = {};
    for (const config of configs ?? []) {
        const { value } = readEnv(config.envKeys);
        if (value)
            headers[config.header] = value;
    }
    return headers;
}
export function redactHeaders(headers) {
    const redacted = {};
    for (const [key, value] of Object.entries(headers)) {
        redacted[key] = isSensitiveHeader(key) ? redactValue(value) : value;
    }
    return redacted;
}
function isSensitiveHeader(key) {
    return ['authorization', 'x-api-key', 'api-key'].includes(key.toLowerCase());
}
function redactValue(value) {
    if (value.length <= 12)
        return '<redacted>';
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
