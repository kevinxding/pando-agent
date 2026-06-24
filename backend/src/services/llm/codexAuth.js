import { readEnv } from './auth.js';
export const CODEX_ACCESS_TOKEN_ENV_KEYS = ['CODEX_ACCESS_TOKEN'];
export const CODEX_ACCOUNT_ID_ENV_KEYS = ['CODEX_CHATGPT_ACCOUNT_ID', 'CHATGPT_ACCOUNT_ID'];
export function createCodexAccessTokenAuth(input = {}) {
    return {
        type: 'codex-access-token',
        envKeys: input.tokenEnvKeys ?? CODEX_ACCESS_TOKEN_ENV_KEYS,
        accountIdEnvKeys: input.accountIdEnvKeys ?? CODEX_ACCOUNT_ID_ENV_KEYS,
    };
}
export function getCodexAuthStatus(input = {}) {
    const token = readEnv(input.tokenEnvKeys ?? CODEX_ACCESS_TOKEN_ENV_KEYS);
    const accountId = readEnv(input.accountIdEnvKeys ?? CODEX_ACCOUNT_ID_ENV_KEYS);
    return {
        accessTokenConfigured: Boolean(token.value),
        accessTokenSource: token.key,
        accountIdConfigured: Boolean(accountId.value),
        accountIdSource: accountId.key,
    };
}
