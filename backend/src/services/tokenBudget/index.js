import { estimateMessages } from '../contextBuilder/index.js';
const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_RESERVE_OUTPUT_TOKENS = 4_096;
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;
const PROVIDER_CONTEXT_WINDOWS = {
    openai: 128_000,
    'openai-codex': 128_000,
    deepseek: 64_000,
    'minimax-cn': 100_000,
    custom: 64_000,
};
export function buildTokenBudgetContext(input) {
    const options = normalizeOptions(input.config?.tokenBudget, input.options, input.reserveOutputTokens);
    const provider = input.model.provider.id;
    const model = input.model.model ?? input.model.provider.defaultModel;
    if (!options.enabled) {
        return {
            stats: disabledStats(provider, model, options),
        };
    }
    const contextWindowTokens = options.contextWindowTokens ?? PROVIDER_CONTEXT_WINDOWS[provider] ?? PROVIDER_CONTEXT_WINDOWS.custom;
    const reserveOutputTokens = Math.min(options.reserveOutputTokens, Math.max(0, contextWindowTokens - 1));
    const maxInputTokens = Math.max(1, contextWindowTokens - reserveOutputTokens);
    const estimatedWithoutMessage = estimateTokensFromChars(estimateMessages(input.messages), options.charsPerToken);
    const draftMessage = options.includeContextMessage
        ? createTokenBudgetMessage({
            threadId: input.threadId,
            windowId: input.windowId,
            contextWindowTokens,
            maxInputTokens,
            estimatedInputTokens: estimatedWithoutMessage,
            estimatedTokensLeft: Math.max(0, maxInputTokens - estimatedWithoutMessage),
        })
        : undefined;
    const estimatedInputTokens = draftMessage
        ? estimatedWithoutMessage + estimateTokensFromChars(estimateMessages([draftMessage]), options.charsPerToken)
        : estimatedWithoutMessage;
    const estimatedTokensLeft = Math.max(0, maxInputTokens - estimatedInputTokens);
    const percentUsed = Math.min(999, Math.round((estimatedInputTokens / maxInputTokens) * 100));
    const stats = {
        enabled: true,
        provider,
        model,
        contextWindowTokens,
        reserveOutputTokens,
        maxInputTokens,
        estimatedInputTokens,
        estimatedTokensLeft,
        percentUsed,
        charsPerToken: options.charsPerToken,
        contextMessageIncluded: Boolean(draftMessage),
        warningThresholdPercent: options.warningThresholdPercent,
        aboveWarningThreshold: percentUsed >= options.warningThresholdPercent,
        overBudget: estimatedInputTokens > maxInputTokens,
    };
    const message = draftMessage
        ? createTokenBudgetMessage({
            threadId: input.threadId,
            windowId: input.windowId,
            contextWindowTokens,
            maxInputTokens,
            estimatedInputTokens,
            estimatedTokensLeft,
        })
        : undefined;
    return {
        message,
        stats: {
            ...stats,
            contextMessageIncluded: Boolean(message),
        },
    };
}
function normalizeOptions(config, override, reserveOutputTokens) {
    return {
        enabled: override?.enabled ?? config?.enabled ?? true,
        contextWindowTokens: override?.contextWindowTokens ?? config?.contextWindowTokens,
        reserveOutputTokens: override?.reserveOutputTokens ?? config?.reserveOutputTokens ?? reserveOutputTokens ?? DEFAULT_RESERVE_OUTPUT_TOKENS,
        charsPerToken: override?.charsPerToken ?? config?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN,
        includeContextMessage: override?.includeContextMessage ?? config?.includeContextMessage ?? true,
        warningThresholdPercent: override?.warningThresholdPercent ?? config?.warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT,
    };
}
function disabledStats(provider, model, options) {
    return {
        enabled: false,
        provider,
        model,
        reserveOutputTokens: options.reserveOutputTokens,
        charsPerToken: options.charsPerToken,
        contextMessageIncluded: false,
        warningThresholdPercent: options.warningThresholdPercent,
        aboveWarningThreshold: false,
        overBudget: false,
    };
}
function createTokenBudgetMessage(input) {
    return {
        role: 'user',
        content: [
            '<token_budget>',
            input.threadId ? `Thread id ${input.threadId}.` : undefined,
            input.windowId !== undefined ? `Current context window ${input.windowId}.` : undefined,
            `Context window: ${input.contextWindowTokens} tokens.`,
            `Max input budget after output reserve: ${input.maxInputTokens} tokens.`,
            `Estimated input tokens already used: ${input.estimatedInputTokens}.`,
            `Estimated tokens left in this context window: ${input.estimatedTokensLeft}.`,
            '</token_budget>',
        ].filter((line) => Boolean(line)).join('\n'),
    };
}
function estimateTokensFromChars(chars, charsPerToken) {
    return Math.max(1, Math.ceil(chars / Math.max(1, charsPerToken)));
}
