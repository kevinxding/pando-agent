import { builtinProviders, createCustomOpenAICompatibleProvider, createDeepSeekProvider, createMiniMaxChinaTokenPlanProvider, createOpenAIProvider, } from '../llm/providers.js';
export const DEFAULT_CONFIG_FILENAMES = ['pandoshare.config.json'];
export const DEFAULT_PROVIDER_ID = 'minimax-cn';
export async function loadProjectConfig(cwd, readFile, filenames = DEFAULT_CONFIG_FILENAMES) {
    for (const filename of filenames) {
        const path = joinPath(cwd, filename);
        const text = await readFile(path);
        if (text === undefined)
            continue;
        return {
            path,
            config: parseProjectConfig(text, path),
        };
    }
    return undefined;
}
export function parseProjectConfig(text, source = 'project config') {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`Invalid JSON in ${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
    assertRecord(parsed, source);
    validateProjectConfig(parsed, source);
    return parsed;
}
export function resolveDefaultModel(config = {}) {
    const providerId = config.model?.provider ?? DEFAULT_PROVIDER_ID;
    const providerConfig = config.providers?.[providerId];
    const provider = providerConfig
        ? createConfiguredProvider(providerId, providerConfig, config.model?.name)
        : createBuiltinProvider(providerId);
    return {
        provider,
        model: config.model?.name ?? providerConfig?.model,
    };
}
export function createConfiguredProvider(providerId, config, selectedModel) {
    const builtin = maybeBuiltinProvider(providerId);
    if (!builtin && !config.baseURL) {
        throw new Error(`Provider "${providerId}" requires baseURL in project config`);
    }
    const base = builtin ?? createCustomOpenAICompatibleProvider({
        id: providerId,
        name: config.name,
        baseURL: required(config.baseURL, `Provider "${providerId}" requires baseURL`),
        model: config.model ?? selectedModel ?? 'custom-model',
        apiKeyEnv: config.apiKeyEnv,
        defaultBody: config.defaultBody,
        capabilities: config.capabilities,
    });
    const auth = resolveAuthConfig(providerId, config, base.auth);
    return {
        ...base,
        name: config.name ?? base.name,
        baseURL: config.baseURL ?? base.baseURL,
        wireProtocol: config.protocol ?? base.wireProtocol,
        defaultModel: config.model ?? selectedModel ?? base.defaultModel,
        auth,
        defaultHeaders: mergeStringRecords(base.defaultHeaders, config.defaultHeaders),
        envHeaders: config.envHeaders ? normalizeEnvHeaders(config.envHeaders) : base.envHeaders,
        defaultBody: mergeUnknownRecords(base.defaultBody, config.defaultBody),
        optionKeys: config.optionKeys ?? base.optionKeys,
        capabilities: {
            ...base.capabilities,
            ...config.capabilities,
        },
    };
}
export function redactProjectConfig(config) {
    return redactValue(config);
}
function createBuiltinProvider(providerId) {
    const provider = maybeBuiltinProvider(providerId);
    if (!provider) {
        throw new Error(`Unknown model provider "${providerId}". Add it under providers in pandoshare.config.json.`);
    }
    return provider;
}
function maybeBuiltinProvider(providerId) {
    switch (providerId) {
        case 'openai':
            return createOpenAIProvider('api-key');
        case 'openai-codex':
            return createOpenAIProvider('codex');
        case 'deepseek':
            return createDeepSeekProvider();
        case 'minimax-cn':
            return createMiniMaxChinaTokenPlanProvider();
        default:
            return undefined;
    }
}
function resolveAuthConfig(providerId, config, fallback) {
    const inlineToken = typeof config.auth?.token === 'string' && config.auth.token.trim()
        ? config.auth.token.trim()
        : typeof config.token === 'string' && config.token.trim()
            ? config.token.trim()
            : undefined;
    if (!config.auth && !config.apiKeyEnv)
        return inlineToken && fallback?.type === 'api-key'
            ? { ...fallback, token: inlineToken }
            : fallback;
    if (!config.auth) {
        return {
            type: 'api-key',
            envKeys: normalizeStringList(config.apiKeyEnv, `providers.${providerId}.apiKeyEnv`),
            ...(inlineToken ? { token: inlineToken } : {}),
        };
    }
    switch (config.auth.type) {
        case 'none':
            return { type: 'none' };
        case 'api-key':
            return {
                type: 'api-key',
                envKeys: normalizeStringList(config.auth.envKeys ?? config.apiKeyEnv, `providers.${providerId}.auth.envKeys`),
                ...(inlineToken ? { token: inlineToken } : {}),
            };
        case 'codex-access-token':
            return {
                type: 'codex-access-token',
                envKeys: normalizeStringList(config.auth.envKeys ?? ['CODEX_ACCESS_TOKEN'], `providers.${providerId}.auth.envKeys`),
                accountIdEnvKeys: normalizeOptionalStringList(config.auth.accountIdEnvKeys, `providers.${providerId}.auth.accountIdEnvKeys`),
            };
    }
}
function validateProjectConfig(config, source) {
    if (config.model !== undefined) {
        assertRecord(config.model, `${source}.model`);
        const model = config.model;
        assertOptionalString(model.provider, `${source}.model.provider`);
        assertOptionalString(model.name, `${source}.model.name`);
        if (model.providerOptions !== undefined)
            assertRecord(model.providerOptions, `${source}.model.providerOptions`);
    }
    if (config.providers !== undefined) {
        assertRecord(config.providers, `${source}.providers`);
        for (const [id, provider] of Object.entries(config.providers)) {
            assertRecord(provider, `${source}.providers.${id}`);
            assertOptionalString(provider.name, `${source}.providers.${id}.name`);
            assertOptionalString(provider.baseURL, `${source}.providers.${id}.baseURL`);
            assertOptionalString(provider.model, `${source}.providers.${id}.model`);
            assertOptionalProtocol(provider.protocol, `${source}.providers.${id}.protocol`);
            assertOptionalStringOrStringList(provider.apiKeyEnv, `${source}.providers.${id}.apiKeyEnv`);
            if (provider.auth !== undefined) {
                assertRecord(provider.auth, `${source}.providers.${id}.auth`);
                const auth = provider.auth;
                if (!['none', 'api-key', 'codex-access-token'].includes(String(auth.type))) {
                    throw new Error(`${source}.providers.${id}.auth.type must be none, api-key, or codex-access-token`);
                }
            }
            if (provider.defaultHeaders !== undefined)
                assertStringRecord(provider.defaultHeaders, `${source}.providers.${id}.defaultHeaders`);
            if (provider.envHeaders !== undefined)
                assertRecord(provider.envHeaders, `${source}.providers.${id}.envHeaders`);
            if (provider.defaultBody !== undefined)
                assertRecord(provider.defaultBody, `${source}.providers.${id}.defaultBody`);
            if (provider.optionKeys !== undefined)
                assertStringList(provider.optionKeys, `${source}.providers.${id}.optionKeys`);
            if (provider.capabilities !== undefined)
                assertProviderCapabilities(provider.capabilities, `${source}.providers.${id}.capabilities`);
        }
    }
    if (config.permissions !== undefined) {
        assertRecord(config.permissions, `${source}.permissions`);
        const permissions = config.permissions;
        assertOneOf(permissions.approvalPolicy, `${source}.permissions.approvalPolicy`, [
            'unless-trusted',
            'on-failure',
            'on-request',
            'granular',
            'never',
        ]);
        assertOneOf(permissions.sandboxMode, `${source}.permissions.sandboxMode`, [
            'read-only',
            'workspace-write',
            'danger-full-access',
        ]);
        if (permissions.approvalsReviewer !== undefined) {
            assertOneOf(permissions.approvalsReviewer, `${source}.permissions.approvalsReviewer`, [
                'user',
                'auto_review',
            ]);
        }
        if (permissions.granular !== undefined)
            assertRecord(permissions.granular, `${source}.permissions.granular`);
        if (permissions.trustedTools !== undefined)
            assertStringList(permissions.trustedTools, `${source}.permissions.trustedTools`);
    }
    if (config.tokenBudget !== undefined) {
        assertRecord(config.tokenBudget, `${source}.tokenBudget`);
        const tokenBudget = config.tokenBudget;
        assertOptionalBoolean(tokenBudget.enabled, `${source}.tokenBudget.enabled`);
        assertOptionalPositiveInteger(tokenBudget.contextWindowTokens, `${source}.tokenBudget.contextWindowTokens`);
        assertOptionalPositiveInteger(tokenBudget.reserveOutputTokens, `${source}.tokenBudget.reserveOutputTokens`);
        assertOptionalPositiveInteger(tokenBudget.charsPerToken, `${source}.tokenBudget.charsPerToken`);
        assertOptionalBoolean(tokenBudget.includeContextMessage, `${source}.tokenBudget.includeContextMessage`);
        assertOptionalPositiveInteger(tokenBudget.warningThresholdPercent, `${source}.tokenBudget.warningThresholdPercent`);
    }
    if (config.mcpServers !== undefined) {
        assertRecord(config.mcpServers, `${source}.mcpServers`);
        for (const [id, server] of Object.entries(config.mcpServers)) {
            assertRecord(server, `${source}.mcpServers.${id}`);
            assertIdentifier(id, `${source}.mcpServers key`);
            assertRequiredString(server.command, `${source}.mcpServers.${id}.command`);
            if (server.args !== undefined)
                assertStringList(server.args, `${source}.mcpServers.${id}.args`);
            assertOptionalPositiveInteger(server.startupTimeoutSec, `${source}.mcpServers.${id}.startupTimeoutSec`);
            assertOptionalOneOf(server.messageFormat, `${source}.mcpServers.${id}.messageFormat`, [
                'content-length',
                'json-lines',
            ]);
        }
    }
    if (config.gateway !== undefined) {
        assertRecord(config.gateway, `${source}.gateway`);
        const gateway = config.gateway;
        assertOptionalBoolean(gateway.enabled, `${source}.gateway.enabled`);
        assertOptionalPositiveInteger(gateway.heartbeatIntervalMs, `${source}.gateway.heartbeatIntervalMs`);
        assertOptionalPositiveInteger(gateway.progressHeartbeatIntervalMs, `${source}.gateway.progressHeartbeatIntervalMs`);
        assertOptionalPositiveInteger(gateway.wakeHeartbeatIntervalMs, `${source}.gateway.wakeHeartbeatIntervalMs`);
        if (gateway.allowUsers !== undefined)
            assertStringList(gateway.allowUsers, `${source}.gateway.allowUsers`);
        assertOptionalString(gateway.pairingSecretEnv, `${source}.gateway.pairingSecretEnv`);
        if (gateway.channels !== undefined) {
            assertRecord(gateway.channels, `${source}.gateway.channels`);
            for (const [id, channel] of Object.entries(gateway.channels)) {
                assertIdentifier(id, `${source}.gateway.channels key`);
                assertRecord(channel, `${source}.gateway.channels.${id}`);
                assertOneOf(channel.kind, `${source}.gateway.channels.${id}.kind`, [
                    'local',
                    'mock',
                    'telegram',
                    'feishu',
                    'lark',
                    'wecom',
                ]);
                assertOptionalBoolean(channel.enabled, `${source}.gateway.channels.${id}.enabled`);
                assertOptionalString(channel.tokenEnv, `${source}.gateway.channels.${id}.tokenEnv`);
                assertOptionalString(channel.chatIdEnv, `${source}.gateway.channels.${id}.chatIdEnv`);
                assertOptionalString(channel.webhookEnv, `${source}.gateway.channels.${id}.webhookEnv`);
                assertOptionalString(channel.ingressSecretEnv, `${source}.gateway.channels.${id}.ingressSecretEnv`);
                if (channel.allowedUsers !== undefined)
                    assertStringList(channel.allowedUsers, `${source}.gateway.channels.${id}.allowedUsers`);
            }
        }
    }
}
function normalizeEnvHeaders(input) {
    return Object.entries(input).map(([header, envKeys]) => ({
        header,
        envKeys: normalizeStringList(envKeys, `envHeaders.${header}`),
    }));
}
function normalizeOptionalStringList(input, name) {
    if (input === undefined)
        return undefined;
    return normalizeStringList(input, name);
}
function normalizeStringList(input, name) {
    if (typeof input === 'string')
        return [input];
    if (Array.isArray(input) && input.every((item) => typeof item === 'string'))
        return input;
    throw new Error(`${name} must be a string or string array`);
}
function mergeStringRecords(base, patch) {
    if (!base && !patch)
        return undefined;
    return { ...base, ...patch };
}
function mergeUnknownRecords(base, patch) {
    if (!base && !patch)
        return undefined;
    return { ...base, ...patch };
}
function required(value, message) {
    if (value === undefined)
        throw new Error(message);
    return value;
}
function assertRecord(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
}
function assertStringRecord(value, name) {
    assertRecord(value, name);
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string')
            throw new Error(`${name}.${key} must be a string`);
    }
}
function assertOptionalString(value, name) {
    if (value !== undefined && typeof value !== 'string') {
        throw new Error(`${name} must be a string`);
    }
}
function assertRequiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} must be a non-empty string`);
    }
}
function assertIdentifier(value, name) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error(`${name} must contain only ASCII letters, digits, underscores, or hyphens`);
    }
}
function assertOptionalBoolean(value, name) {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`${name} must be a boolean`);
    }
}
function assertOptionalPositiveInteger(value, name) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
        throw new Error(`${name} must be a positive integer`);
    }
}
function assertStringList(value, name) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new Error(`${name} must be a string array`);
    }
}
function assertOptionalStringOrStringList(value, name) {
    if (value === undefined)
        return;
    if (typeof value === 'string')
        return;
    assertStringList(value, name);
}
function assertOptionalProtocol(value, name) {
    if (value === undefined)
        return;
    if (value !== 'openai-chat-completions' && value !== 'openai-responses') {
        throw new Error(`${name} must be openai-chat-completions or openai-responses`);
    }
}
function assertProviderCapabilities(value, name) {
    assertRecord(value, name);
    assertOptionalBoolean(value.tools, `${name}.tools`);
    assertOptionalBoolean(value.vision, `${name}.vision`);
    assertOptionalBoolean(value.streaming, `${name}.streaming`);
    assertOptionalBoolean(value.reasoning, `${name}.reasoning`);
    assertOptionalPositiveInteger(value.contextWindowTokens, `${name}.contextWindowTokens`);
}
function assertOneOf(value, name, options) {
    if (typeof value !== 'string' || !options.includes(value)) {
        throw new Error(`${name} must be one of: ${options.join(', ')}`);
    }
}
function assertOptionalOneOf(value, name, options) {
    if (value === undefined)
        return;
    assertOneOf(value, name, options);
}
function joinPath(base, filename) {
    const separator = base.includes('\\') ? '\\' : '/';
    return `${base.replace(/[\\/]+$/, '')}${separator}${filename}`;
}
function redactValue(value) {
    if (Array.isArray(value))
        return value.map(redactValue);
    if (!value || typeof value !== 'object')
        return value;
    const redacted = {};
    for (const [key, item] of Object.entries(value)) {
        redacted[key] = isSecretKey(key) ? '<redacted>' : redactValue(item);
    }
    return redacted;
}
function isSecretKey(key) {
    const normalized = key.toLowerCase();
    return normalized.includes('apikey') || normalized.includes('api_key') || normalized.includes('token');
}
export { builtinProviders };
