import { createCodexAccessTokenAuth } from './codexAuth.js';
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const MINIMAX_CN_BASE_URL = 'https://api.minimaxi.com/v1';
const OPENAI_CAPABILITIES = {
    tools: true,
    vision: true,
    streaming: false,
    reasoning: true,
    contextWindowTokens: 128_000,
};
const DEEPSEEK_CAPABILITIES = {
    tools: true,
    vision: false,
    streaming: false,
    reasoning: true,
    contextWindowTokens: 128_000,
};
const MINIMAX_CN_CAPABILITIES = {
    tools: true,
    vision: false,
    streaming: false,
    reasoning: true,
    contextWindowTokens: 100_000,
};
const CUSTOM_OPENAI_COMPATIBLE_CAPABILITIES = {
    tools: true,
    vision: false,
    streaming: false,
    reasoning: false,
    contextWindowTokens: 32_000,
};
export function createOpenAIProvider(authMode = 'api-key') {
    if (authMode === 'codex') {
        return {
            id: 'openai-codex',
            name: 'OpenAI Codex ChatGPT Login',
            baseURL: OPENAI_CODEX_BASE_URL,
            wireProtocol: 'openai-responses',
            defaultModel: 'gpt-5.5',
            auth: createCodexAccessTokenAuth(),
            capabilities: OPENAI_CAPABILITIES,
            defaultHeaders: {
                version: 'pandoshare-agent',
            },
            envHeaders: [
                { header: 'OpenAI-Organization', envKeys: ['OPENAI_ORGANIZATION'] },
                { header: 'OpenAI-Project', envKeys: ['OPENAI_PROJECT'] },
            ],
            optionKeys: ['openai'],
        };
    }
    return {
        id: 'openai',
        name: 'OpenAI API',
        baseURL: OPENAI_API_BASE_URL,
        wireProtocol: 'openai-responses',
        defaultModel: 'gpt-5.5',
        auth: {
            type: 'api-key',
            envKeys: ['OPENAI_API_KEY'],
        },
        capabilities: OPENAI_CAPABILITIES,
        envHeaders: [
            { header: 'OpenAI-Organization', envKeys: ['OPENAI_ORGANIZATION'] },
            { header: 'OpenAI-Project', envKeys: ['OPENAI_PROJECT'] },
        ],
        optionKeys: ['openai'],
    };
}
export function createDeepSeekProvider() {
    return {
        id: 'deepseek',
        name: 'DeepSeek',
        baseURL: DEEPSEEK_BASE_URL,
        wireProtocol: 'openai-chat-completions',
        defaultModel: 'deepseek-v4-flash',
        auth: {
            type: 'api-key',
            envKeys: ['DEEPSEEK_API_KEY'],
        },
        capabilities: DEEPSEEK_CAPABILITIES,
        optionKeys: ['deepseek', 'openaiCompatible'],
    };
}
export function createMiniMaxChinaTokenPlanProvider() {
    return {
        id: 'minimax-cn',
        name: 'MiniMax China Token Plan',
        baseURL: MINIMAX_CN_BASE_URL,
        wireProtocol: 'openai-chat-completions',
        defaultModel: 'MiniMax-M3',
        auth: {
            type: 'api-key',
            envKeys: ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
        },
        capabilities: MINIMAX_CN_CAPABILITIES,
        defaultBody: {
            reasoning_split: true,
        },
        optionKeys: ['minimax', 'openaiCompatible'],
    };
}
export function createCustomOpenAICompatibleProvider(input) {
    const envKeys = Array.isArray(input.apiKeyEnv)
        ? input.apiKeyEnv
        : input.apiKeyEnv
            ? [input.apiKeyEnv]
            : ['CUSTOM_LLM_API_KEY'];
    return {
        id: input.id ?? 'custom',
        name: input.name ?? 'Custom OpenAI-Compatible Provider',
        baseURL: input.baseURL,
        wireProtocol: 'openai-chat-completions',
        defaultModel: input.model,
        auth: {
            type: 'api-key',
            envKeys,
            token: input.token,
        },
        capabilities: {
            ...CUSTOM_OPENAI_COMPATIBLE_CAPABILITIES,
            ...input.capabilities,
        },
        defaultBody: input.defaultBody,
        optionKeys: ['custom', 'openaiCompatible'],
    };
}
export const builtinProviders = {
    openai: createOpenAIProvider('api-key'),
    openaiCodex: createOpenAIProvider('codex'),
    deepseek: createDeepSeekProvider(),
    minimaxChinaTokenPlan: createMiniMaxChinaTokenPlanProvider(),
};
