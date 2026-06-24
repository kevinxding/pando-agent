import { resolveAuth, resolveEnvHeaders, redactHeaders } from './auth.js';
import { buildOpenAIChatBody, openAIChatPath, parseOpenAIChatText, parseOpenAIChatToolCalls, parseOpenAIChatUsage, } from './protocols/openaiChat.js';
import { buildOpenAIResponsesBody, openAIResponsesPath, parseOpenAIResponsesText, parseOpenAIResponsesToolCalls, parseOpenAIResponsesUsage, } from './protocols/openaiResponses.js';
export class LLMProviderError extends Error {
    category;
    provider;
    model;
    status;
    retryable;
    retryAfterMs;
    constructor(input) {
        super(input.message);
        this.name = 'LLMProviderError';
        this.category = input.category;
        this.provider = input.provider;
        this.model = input.model;
        this.status = input.status;
        this.retryable = input.retryable ?? false;
        this.retryAfterMs = input.retryAfterMs;
        if (input.cause !== undefined) {
            ;
            this.cause = input.cause;
        }
    }
}
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 2,
    initialDelayMs: 250,
    maxDelayMs: 2_000,
    jitter: true,
};
export function prepareLLMRequest(request, options = {}) {
    const provider = request.model.provider;
    const auth = options.includeAuth === false
        ? {
            headers: {},
            redactedHeaders: {},
            missingEnv: provider.auth.type === 'none' ? undefined : provider.auth.envKeys,
        }
        : resolveAuth(provider.auth, options.requireAuth ?? true);
    const body = buildBody(request);
    const url = buildUrl(request);
    const headers = {
        'Content-Type': 'application/json',
        ...provider.defaultHeaders,
        ...resolveEnvHeaders(provider.envHeaders),
        ...auth.headers,
    };
    return {
        provider: provider.id,
        protocol: provider.wireProtocol,
        model: request.model.model ?? provider.defaultModel,
        method: 'POST',
        url,
        headers,
        redactedHeaders: redactHeaders({ ...headers, ...auth.redactedHeaders }),
        body,
        missingAuthEnv: auth.missingEnv,
        authSource: auth.source,
    };
}
export async function generateText(request, options = {}) {
    let prepared;
    try {
        prepared = prepareLLMRequest({ ...request, stream: false });
    }
    catch (error) {
        throw normalizePrepareError(error, request);
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!fetcher) {
        throw new LLMProviderError({
            category: 'network_error',
            provider: request.model.provider.id,
            model: request.model.model ?? request.model.provider.defaultModel,
            retryable: false,
            message: 'global fetch is not available. Use Node.js 18+ or pass GenerateOptions.fetch.',
        });
    }
    const retry = normalizeRetryConfig(options.retry);
    let attempt = 0;
    while (true) {
        try {
            return await sendPreparedRequest(prepared, fetcher, options.signal);
        }
        catch (error) {
            if (!shouldRetry(error, retry, attempt))
                throw error;
            attempt += 1;
            const delayMs = delayForRetry(error, retry, attempt);
            await notifyRetry(error, prepared, retry, attempt, delayMs, options.onRetry);
            await sleep(delayMs, options.signal);
        }
    }
}
export async function* streamText(request, options = {}) {
    let prepared;
    try {
        prepared = prepareLLMRequest({ ...request, stream: true });
    }
    catch (error) {
        throw normalizePrepareError(error, request);
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!fetcher) {
        throw new LLMProviderError({
            category: 'network_error',
            provider: request.model.provider.id,
            model: request.model.model ?? request.model.provider.defaultModel,
            retryable: false,
            message: 'global fetch is not available. Use Node.js 18+ or pass GenerateOptions.fetch.',
        });
    }
    const retry = normalizeRetryConfig(options.retry);
    let attempt = 0;
    while (true) {
        try {
            yield* sendPreparedStreamRequest(prepared, fetcher, options.signal);
            return;
        }
        catch (error) {
            if (!shouldRetry(error, retry, attempt))
                throw error;
            attempt += 1;
            const delayMs = delayForRetry(error, retry, attempt);
            await notifyRetry(error, prepared, retry, attempt, delayMs, options.onRetry);
            await sleep(delayMs, options.signal);
        }
    }
}
async function sendPreparedRequest(prepared, fetcher, signal) {
    let response;
    try {
        response = await fetcher(prepared.url, {
            method: prepared.method,
            headers: prepared.headers,
            body: JSON.stringify(prepared.body),
            signal,
        });
    }
    catch (error) {
        const message = errorMessage(error);
        const contextTooLong = isContextLengthMessage(message);
        throw new LLMProviderError({
            category: contextTooLong ? 'context_too_long' : 'network_error',
            provider: prepared.provider,
            model: prepared.model,
            retryable: !contextTooLong,
            message: contextTooLong ? `LLM context error: ${message}` : `LLM network error: ${message}`,
            cause: error,
        });
    }
    const text = await response.text();
    let raw;
    try {
        raw = text ? JSON.parse(text) : {};
    }
    catch (error) {
        throw new LLMProviderError({
            category: 'provider_invalid_response',
            provider: prepared.provider,
            model: prepared.model,
            status: response.status,
            retryable: false,
            message: `LLM provider returned invalid JSON: ${previewText(text, 300)}`,
            cause: error,
        });
    }
    if (!response.ok) {
        const category = classifyLLMStatus(response.status, errorMessage(raw));
        throw new LLMProviderError({
            category,
            provider: prepared.provider,
            model: prepared.model,
            status: response.status,
            retryable: isRetryableLLMError(category, response.status),
            retryAfterMs: retryAfterMs(response.headers),
            message: `LLM request failed [${category}]: ${response.status} ${response.statusText}: ${errorMessage(raw)}`,
        });
    }
    return {
        provider: prepared.provider,
        model: prepared.model,
        text: parseText(prepared.protocol, raw),
        toolCalls: parseToolCalls(prepared.protocol, raw),
        usage: parseUsage(prepared.protocol, raw),
        raw,
    };
}
async function* sendPreparedStreamRequest(prepared, fetcher, signal) {
    let response;
    try {
        response = await fetcher(prepared.url, {
            method: prepared.method,
            headers: prepared.headers,
            body: JSON.stringify(prepared.body),
            signal,
        });
    }
    catch (error) {
        throw new LLMProviderError({
            category: 'network_error',
            provider: prepared.provider,
            model: prepared.model,
            retryable: true,
            message: `LLM network error: ${errorMessage(error)}`,
            cause: error,
        });
    }
    if (!response.ok) {
        await throwProviderStatusError(response, prepared);
    }
    if (!response.body) {
        throw new LLMProviderError({
            category: 'provider_invalid_response',
            provider: prepared.provider,
            model: prepared.model,
            status: response.status,
            retryable: false,
            message: 'LLM provider streaming response did not include a body.',
        });
    }
    let text = '';
    let usage;
    let rawEventCount = 0;
    let toolCallOrder = 0;
    const toolCallDrafts = new Map();
    for await (const data of readSseData(response.body)) {
        if (data === '[DONE]')
            break;
        let raw;
        try {
            raw = JSON.parse(data);
        }
        catch (error) {
            throw new LLMProviderError({
                category: 'provider_invalid_response',
                provider: prepared.provider,
                model: prepared.model,
                status: response.status,
                retryable: false,
                message: `LLM provider returned invalid stream JSON: ${previewText(data, 300)}`,
                cause: error,
            });
        }
        rawEventCount += 1;
        usage = streamUsageFromRecord(raw) ?? usage;
        toolCallOrder = mergeStreamToolCallParts(toolCallDrafts, raw, toolCallOrder);
        const delta = streamDeltaFromRecord(raw);
        if (!delta)
            continue;
        text += delta;
        yield {
            type: 'text_delta',
            provider: prepared.provider,
            model: prepared.model,
            delta,
            raw,
        };
    }
    yield {
        type: 'completed',
        provider: prepared.provider,
        model: prepared.model,
        text,
        toolCalls: finalizeStreamToolCalls(toolCallDrafts),
        usage,
        raw: { eventCount: rawEventCount },
    };
}
async function throwProviderStatusError(response, prepared) {
    const text = await response.text();
    let raw;
    try {
        raw = text ? JSON.parse(text) : {};
    }
    catch {
        raw = text;
    }
    const category = classifyLLMStatus(response.status, errorMessage(raw));
    throw new LLMProviderError({
        category,
        provider: prepared.provider,
        model: prepared.model,
        status: response.status,
        retryable: isRetryableLLMError(category, response.status),
        retryAfterMs: retryAfterMs(response.headers),
        message: `LLM request failed [${category}]: ${response.status} ${response.statusText}: ${errorMessage(raw)}`,
    });
}
function normalizeRetryConfig(input) {
    if (input === false) {
        return {
            maxRetries: 0,
            initialDelayMs: 0,
            maxDelayMs: 0,
            jitter: false,
        };
    }
    return {
        maxRetries: boundedInteger(input?.maxRetries, DEFAULT_RETRY_CONFIG.maxRetries, 0, 10),
        initialDelayMs: boundedInteger(input?.initialDelayMs, DEFAULT_RETRY_CONFIG.initialDelayMs, 0, 60_000),
        maxDelayMs: boundedInteger(input?.maxDelayMs, DEFAULT_RETRY_CONFIG.maxDelayMs, 0, 60_000),
        jitter: input?.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
    };
}
async function* readSseData(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let splitIndex = sseBoundaryIndex(buffer);
            while (splitIndex !== -1) {
                const block = buffer.slice(0, splitIndex);
                buffer = buffer.slice(splitIndex + sseBoundaryLength(buffer, splitIndex));
                const data = sseDataFromBlock(block);
                if (data !== undefined)
                    yield data;
                splitIndex = sseBoundaryIndex(buffer);
            }
        }
        buffer += decoder.decode();
        const data = sseDataFromBlock(buffer);
        if (data !== undefined)
            yield data;
    }
    finally {
        reader.releaseLock();
    }
}
function sseBoundaryIndex(buffer) {
    const indexes = [buffer.indexOf('\r\n\r\n'), buffer.indexOf('\n\n'), buffer.indexOf('\r\r')]
        .filter(index => index >= 0);
    return indexes.length ? Math.min(...indexes) : -1;
}
function sseBoundaryLength(buffer, index) {
    return buffer.startsWith('\r\n\r\n', index) ? 4 : 2;
}
function sseDataFromBlock(block) {
    const lines = block.split(/\r?\n|\r/);
    const data = lines
        .map(line => line.trimEnd())
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart());
    if (!data.length)
        return undefined;
    return data.join('\n').trim();
}
function streamDeltaFromRecord(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const record = raw;
    if (typeof record.delta === 'string')
        return record.delta;
    if (typeof record.text === 'string')
        return record.text;
    if (record.type === 'response.output_text.delta' && typeof record.delta === 'string')
        return record.delta;
    const choices = record.choices;
    if (Array.isArray(choices)) {
        for (const choice of choices) {
            if (!choice || typeof choice !== 'object')
                continue;
            const delta = choice.delta?.content;
            if (typeof delta === 'string')
                return delta;
            const content = choice.message?.content;
            if (typeof content === 'string')
                return content;
        }
    }
    return undefined;
}
function streamUsageFromRecord(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const record = raw;
    if (record.usage !== undefined)
        return record.usage;
    const response = record.response;
    if (response && typeof response === 'object' && !Array.isArray(response)) {
        return response.usage;
    }
    return undefined;
}
function mergeStreamToolCallParts(drafts, raw, nextOrder) {
    for (const part of streamToolCallPartsFromRecord(raw)) {
        let draft = drafts.get(part.key);
        if (!draft) {
            draft = {
                key: part.key,
                order: nextOrder,
                arguments: '',
            };
            nextOrder += 1;
            drafts.set(part.key, draft);
        }
        if (part.id)
            draft.id = part.id;
        if (part.name)
            draft.name = part.name;
        if (part.argumentsFull !== undefined) {
            draft.arguments = part.argumentsFull;
        }
        else if (part.argumentsDelta !== undefined) {
            draft.arguments += part.argumentsDelta;
        }
    }
    return nextOrder;
}
function streamToolCallPartsFromRecord(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const record = raw;
    const parts = [];
    const choices = record.choices;
    if (Array.isArray(choices)) {
        for (const choice of choices) {
            if (!choice || typeof choice !== 'object')
                continue;
            const choiceRecord = choice;
            parts.push(...chatToolCallParts(choiceRecord.delta, false));
            parts.push(...chatToolCallParts(choiceRecord.message, true));
        }
    }
    const item = record.item;
    if (record.type === 'response.output_item.done' &&
        item &&
        typeof item === 'object' &&
        !Array.isArray(item)) {
        const itemRecord = item;
        if (itemRecord.type === 'function_call' || itemRecord.type === 'custom_tool_call') {
            const id = firstString(itemRecord.call_id, itemRecord.id);
            const name = firstString(itemRecord.name);
            const rawInput = stringifyToolInput(itemRecord.arguments ?? itemRecord.input);
            if (name) {
                parts.push({
                    key: `responses:${id ?? name}`,
                    id,
                    name,
                    argumentsFull: rawInput,
                });
            }
        }
    }
    return parts;
}
function chatToolCallParts(value, complete) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return [];
    const toolCalls = value.tool_calls;
    if (!Array.isArray(toolCalls))
        return [];
    return toolCalls.flatMap((toolCall, fallbackIndex) => {
        if (!toolCall || typeof toolCall !== 'object')
            return [];
        const record = toolCall;
        const fn = record.function;
        const functionRecord = fn && typeof fn === 'object' && !Array.isArray(fn)
            ? fn
            : {};
        const id = firstString(record.id);
        const name = firstString(functionRecord.name);
        const rawArguments = functionRecord.arguments;
        const argumentText = typeof rawArguments === 'string'
            ? rawArguments
            : rawArguments === undefined
                ? undefined
                : stringifyToolInput(rawArguments);
        const key = `chat:${typeof record.index === 'number' ? record.index : id ?? fallbackIndex}`;
        return [
            {
                key,
                id,
                name,
                ...(complete ? { argumentsFull: argumentText } : { argumentsDelta: argumentText }),
            },
        ];
    });
}
function finalizeStreamToolCalls(drafts) {
    return [...drafts.values()]
        .sort((left, right) => left.order - right.order)
        .flatMap((draft, index) => {
        if (!draft.name)
            return [];
        const rawInput = draft.arguments || '{}';
        return [
            {
                id: draft.id ?? `call_${index}`,
                name: draft.name,
                input: parseToolInput(rawInput),
                rawInput,
            },
        ];
    });
}
function stringifyToolInput(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined)
        return '{}';
    return JSON.stringify(value);
}
function parseToolInput(value) {
    try {
        const parsed = value ? JSON.parse(value) : {};
        return isRecord(parsed) ? parsed : { value: parsed };
    }
    catch {
        return { raw: value };
    }
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value)
            return value;
    }
    return undefined;
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function shouldRetry(error, retry, attempt) {
    return error instanceof LLMProviderError && error.retryable && attempt < retry.maxRetries;
}
function delayForRetry(error, retry, attempt) {
    const retryAfter = error instanceof LLMProviderError ? error.retryAfterMs : undefined;
    if (retryAfter !== undefined)
        return Math.min(retry.maxDelayMs, retryAfter);
    const exponential = retry.initialDelayMs * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(retry.maxDelayMs, exponential);
    if (!retry.jitter || capped <= 0)
        return capped;
    return Math.max(0, Math.round(capped * (0.5 + Math.random() * 0.5)));
}
async function notifyRetry(error, prepared, retry, attempt, delayMs, onRetry) {
    if (!(error instanceof LLMProviderError))
        return;
    try {
        await onRetry?.({
            provider: prepared.provider,
            model: prepared.model,
            attempt,
            nextAttempt: attempt + 1,
            maxRetries: retry.maxRetries,
            delayMs,
            category: error.category,
            status: error.status,
            retryable: error.retryable,
            message: error.message,
        });
    }
    catch {
        // Retry observation should not make the model request fail.
    }
}
function sleep(ms, signal) {
    if (ms <= 0)
        return Promise.resolve();
    if (signal?.aborted)
        return Promise.reject(new Error('LLM retry aborted.'));
    return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(resolvePromise, ms);
        const abort = () => {
            clearTimeout(timeout);
            reject(new Error('LLM retry aborted.'));
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}
function boundedInteger(value, fallback, min, max) {
    if (value === undefined || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}
function retryAfterMs(headers) {
    const value = headers.get('retry-after');
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.trunc(seconds * 1000);
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp))
        return Math.max(0, timestamp - Date.now());
    return undefined;
}
function normalizePrepareError(error, request) {
    const message = errorMessage(error);
    return new LLMProviderError({
        category: /missing auth token|api key|access token/i.test(message) ? 'auth_failed' : 'provider_error',
        provider: request.model.provider.id,
        model: request.model.model ?? request.model.provider.defaultModel,
        retryable: false,
        message,
        cause: error,
    });
}
export function classifyLLMStatus(status, message) {
    if (status === 401 || status === 403 || /auth|unauthorized|forbidden|api key|token|credential/i.test(message)) {
        return 'auth_failed';
    }
    if (status === 429 || /rate limit|too many requests|quota/i.test(message)) {
        return 'rate_limited';
    }
    if (isContextLengthMessage(message)) {
        return 'context_too_long';
    }
    if (status >= 500)
        return 'provider_error';
    return 'provider_error';
}
function isContextLengthMessage(message) {
    return /context_length|context window|maximum context|context limit|too\s*long|prompt.{0,80}(long|large|limit|exceed)|token.{0,80}(limit|exceed|maximum)|exceed.{0,80}(context|token)/i.test(message);
}
export function isRetryableLLMError(category, status) {
    if (category === 'rate_limited' || category === 'network_error')
        return true;
    return typeof status === 'number' && status >= 500;
}
function buildBody(request) {
    switch (request.model.provider.wireProtocol) {
        case 'openai-chat-completions':
            return buildOpenAIChatBody(request);
        case 'openai-responses':
            return buildOpenAIResponsesBody(request);
    }
}
function buildUrl(request) {
    switch (request.model.provider.wireProtocol) {
        case 'openai-chat-completions':
            return openAIChatPath(request.model.provider.baseURL);
        case 'openai-responses':
            return openAIResponsesPath(request.model.provider.baseURL);
    }
}
function parseText(protocol, raw) {
    switch (protocol) {
        case 'openai-chat-completions':
            return parseOpenAIChatText(raw);
        case 'openai-responses':
            return parseOpenAIResponsesText(raw);
    }
}
function parseUsage(protocol, raw) {
    switch (protocol) {
        case 'openai-chat-completions':
            return parseOpenAIChatUsage(raw);
        case 'openai-responses':
            return parseOpenAIResponsesUsage(raw);
    }
}
function parseToolCalls(protocol, raw) {
    switch (protocol) {
        case 'openai-chat-completions':
            return parseOpenAIChatToolCalls(raw);
        case 'openai-responses':
            return parseOpenAIResponsesToolCalls(raw);
    }
}
function errorMessage(raw) {
    if (raw instanceof Error)
        return raw.message;
    const value = raw;
    if (typeof value.error?.message === 'string')
        return value.error.message;
    if (typeof value.message === 'string')
        return value.message;
    try {
        return JSON.stringify(raw);
    }
    catch {
        return String(raw);
    }
}
function previewText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)} [truncated ${value.length - maxChars} chars]`;
}
