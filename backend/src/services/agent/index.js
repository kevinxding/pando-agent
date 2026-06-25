import { resolveDefaultModel } from '../config/index.js';
import { emitAgentEvent, eventBase, previewText, summarizeToolCalls, } from '../events/index.js';
import { generateText, streamText } from '../llm/client.js';
import { runTools } from '../tools/toolOrchestration.js';
export class AgentSession {
    model;
    system;
    defaultMaxTokens;
    defaultTemperature;
    defaultProviderOptions;
    defaultFetch;
    defaultStream;
    messages;
    turnCounter = 0;
    constructor(options = {}) {
        this.model = options.model ?? resolveDefaultModel(options.config ?? {});
        this.system = options.system;
        this.defaultMaxTokens = options.maxTokens;
        this.defaultTemperature = options.temperature;
        this.defaultProviderOptions = mergeProviderOptions(options.config?.model?.providerOptions, options.providerOptions);
        this.defaultFetch = options.fetch;
        this.defaultStream = options.stream;
        this.messages = [...(options.initialMessages ?? [])];
    }
    history() {
        return [...this.messages];
    }
    async runTurn(input) {
        const prompt = input.prompt.trim();
        if (!prompt)
            throw new Error('Agent turn prompt must not be empty');
        const turnId = `turn-${Date.now()}-${++this.turnCounter}`;
        const turnStartedAtMs = Date.now();
        if (input.toolContext)
            input.toolContext.turnId = turnId;
        await emitAgentEvent(input.toolContext, {
            ...eventBase(eventContext(input, turnId), 'turn_started'),
            type: 'turn_started',
            promptPreview: previewText(prompt, 500),
        });
        const tools = input.toolRegistry ? toolSpecsForRegistry(input.toolRegistry) : undefined;
        const toolResults = [];
        const toolCalls = [];
        const maxToolRounds = normalizeMaxToolRounds(input.maxToolRounds);
        const maxAutoContinuationRounds = normalizeAutoContinuationRounds(input.maxAutoContinuationRounds);
        let response;
        let nextPrompt = prompt;
        let persistNextPrompt = true;
        let rounds = 0;
        let autoContinuationRounds = 0;
        try {
            while (true) {
                const round = rounds + 1;
                await emitAgentEvent(input.toolContext, {
                    ...eventBase(eventContext(input, turnId), 'model_request_started'),
                    type: 'model_request_started',
                    provider: this.model.provider.id,
                    model: this.model.model ?? this.model.provider.defaultModel,
                    round,
                    toolCount: tools?.length ?? 0,
                });
                const modelRequest = {
                    model: this.model,
                    system: input.system ?? this.system,
                    messages: toChatMessages(this.messages),
                    prompt: nextPrompt,
                    tools,
                    toolChoice: tools?.length ? 'auto' : undefined,
                    temperature: input.temperature ?? this.defaultTemperature ?? 0,
                    maxTokens: input.maxTokens ?? this.defaultMaxTokens ?? 1024,
                    providerOptions: mergeProviderOptions(defaultAgentProviderOptions(this.model.provider.id), mergeProviderOptions(this.defaultProviderOptions, input.providerOptions)),
                };
                const modelOptions = {
                    fetch: input.fetch ?? this.defaultFetch,
                    signal: input.abortSignal,
                    onRetry: retry => emitAgentEvent(input.toolContext, {
                        ...eventBase(eventContext(input, turnId), 'model_retry_scheduled'),
                        type: 'model_retry_scheduled',
                        provider: retry.provider,
                        model: retry.model,
                        round,
                        attempt: retry.attempt,
                        nextAttempt: retry.nextAttempt,
                        maxRetries: retry.maxRetries,
                        delayMs: retry.delayMs,
                        category: retry.category,
                        status: retry.status,
                        retryable: retry.retryable,
                        message: retry.message,
                    }),
                };
                const modelResult = await requestModelResponse(modelRequest, modelOptions, {
                    stream: shouldStreamTextResponse(input.stream ?? this.defaultStream, this.model),
                    hasTools: Boolean(tools?.length),
                    toolContext: input.toolContext,
                    eventContext: eventContext(input, turnId),
                });
                response = modelResult.response;
                if (nextPrompt !== undefined) {
                    if (persistNextPrompt)
                        this.messages.push({ role: 'user', content: nextPrompt });
                    nextPrompt = undefined;
                    persistNextPrompt = true;
                }
                const responseToolCalls = [...(response.toolCalls ?? [])];
                await emitAgentEvent(input.toolContext, {
                    ...eventBase(eventContext(input, turnId), 'model_response_completed'),
                    type: 'model_response_completed',
                    provider: response.provider,
                    model: response.model,
                    round,
                    textPreview: previewText(response.text),
                    toolCalls: summarizeToolCalls(responseToolCalls),
                    usage: response.usage,
                });
                if (response.text && !modelResult.deltaEventsEmitted) {
                    await emitAgentEvent(input.toolContext, {
                        ...eventBase(eventContext(input, turnId), 'agent_message_delta'),
                        type: 'agent_message_delta',
                        delta: response.text,
                    });
                }
                if (response.text) {
                    await emitAgentEvent(input.toolContext, {
                        ...eventBase(eventContext(input, turnId), 'agent_message_completed'),
                        type: 'agent_message_completed',
                        textPreview: previewText(response.text),
                    });
                }
                toolCalls.push(...responseToolCalls);
                this.messages.push({
                    role: 'assistant',
                    content: response.text,
                    toolCalls: responseToolCalls.length ? responseToolCalls : undefined,
                });
                if (!responseToolCalls.length && shouldAutoContinueAssistantResponse(response.text) && autoContinuationRounds < maxAutoContinuationRounds) {
                    autoContinuationRounds += 1;
                    nextPrompt = buildAutoContinuationPrompt(response.text);
                    persistNextPrompt = false;
                    continue;
                }
                if (!responseToolCalls.length || !input.toolRegistry || !input.toolContext)
                    break;
                if (maxToolRounds !== undefined && rounds >= maxToolRounds) {
                    const message = `Tool loop stopped after ${maxToolRounds} tool round(s).`;
                    await emitAgentEvent(input.toolContext, {
                        ...eventBase(eventContext(input, turnId), 'tool_loop_stopped'),
                        type: 'tool_loop_stopped',
                        message,
                        maxToolRounds,
                        pendingToolCallIds: responseToolCalls.map(toolCall => toolCall.id),
                    });
                    for (const toolCall of responseToolCalls) {
                        const result = {
                            toolUseId: toolCall.id,
                            ok: false,
                            isError: true,
                            content: message,
                        };
                        toolResults.push(result);
                        this.messages.push({
                            role: 'tool',
                            content: result.content,
                            toolCallId: result.toolUseId,
                        });
                    }
                    break;
                }
                rounds += 1;
                const toolUses = responseToolCalls.map(toToolUse);
                for await (const update of runTools(toolUses, input.toolRegistry, input.toolContext)) {
                    toolResults.push(update.result);
                    this.messages.push({
                        role: 'tool',
                        content: update.result.content,
                        toolCallId: update.result.toolUseId,
                    });
                }
            }
            if (!response)
                throw new Error('Agent turn did not produce a model response');
            const finalText = response.text;
            await emitAgentEvent(input.toolContext, {
                ...eventBase(eventContext(input, turnId), 'turn_completed'),
                type: 'turn_completed',
                ok: true,
                finalTextPreview: previewText(finalText),
                rounds,
                usage: response.usage,
                durationMs: Date.now() - turnStartedAtMs,
            });
            return {
                finalText,
                provider: response.provider,
                model: response.model,
                messages: this.history(),
                toolCalls,
                toolResults,
                rounds,
                usage: response.usage,
                response,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await emitAgentEvent(input.toolContext, {
                ...eventBase(eventContext(input, turnId), 'turn_failed'),
                type: 'turn_failed',
                ok: false,
                message,
                durationMs: Date.now() - turnStartedAtMs,
            });
            throw error;
        }
    }
}
export async function runAgentTurn(input) {
    const session = new AgentSession(input);
    return session.runTurn(input);
}
function toChatMessages(messages) {
    return messages.map((message) => ({
        role: message.role,
        content: message.content,
        toolCallId: message.toolCallId,
        toolCalls: message.toolCalls,
    }));
}
function toolSpecsForRegistry(registry) {
    return registry.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
    }));
}
function toToolUse(toolCall) {
    return {
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
    };
}
function normalizeMaxToolRounds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return undefined;
    return Math.max(0, Math.floor(value));
}
function normalizeAutoContinuationRounds(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return 2;
    return Math.max(0, Math.floor(value));
}
function shouldAutoContinueAssistantResponse(text) {
    const normalized = String(text ?? '').trim();
    if (normalized.length < 12 || normalized.length > 500)
        return false;
    if (hasDeliverableBody(normalized))
        return false;
    return /(?:\u4e0b\u9762|\u63a5\u4e0b\u6765|\u968f\u540e|\u73b0\u5728|\u6211\u5c06|\u6211\u4f1a|\u6211\u6765|\u8ba9\u6211|\u5f00\u59cb).{0,60}(?:\u7ed9\u51fa|\u6574\u7406|\u7ec4\u7ec7|\u751f\u6210|\u521b\u5efa|\u5199\u51fa|\u5217\u51fa|\u8f93\u51fa|\u63d0\u4f9b|\u5236\u4f5c|\u5b8c\u6210|\u7ee7\u7eed)/.test(normalized) ||
        /(?:next|below|now|will|going to|let me).{0,80}(?:provide|generate|create|write|list|organize|output|continue|complete)/i.test(normalized);
}
function hasDeliverableBody(text) {
    return /(?:\u7b2c[\u4e00-\u9fa50-9]+\u9875|Slide\s*\d+|PPT\s*\d+|^#{1,3}\s|```|\u5982\u4e0b[:\uff1a])/im.test(text);
}
function buildAutoContinuationPrompt(previousText) {
    return [
        'Your previous answer stopped after promising to continue.',
        'Previous answer: ' + previousText,
        'Continue now with the actual requested deliverable. Do not restate that you will do it. If tool work is required, call the needed tool; otherwise write the full result directly.',
    ].join('\n\n');
}
function eventContext(input, turnId) {
    return {
        sessionId: input.toolContext?.sessionId ?? 'agent-session',
        runId: input.toolContext?.runId,
        turnId,
    };
}
async function requestModelResponse(request, options, context) {
    if (!context.stream) {
        return {
            response: await generateText(request, options),
            deltaEventsEmitted: false,
        };
    }
    let text = '';
    let usage;
    let raw;
    let toolCalls = [];
    let provider = request.model.provider.id;
    let model = request.model.model ?? request.model.provider.defaultModel;
    let deltaEventsEmitted = false;
    let completed = false;
    for await (const event of streamText(request, options)) {
        provider = event.provider;
        model = event.model;
        if (event.type === 'text_delta') {
            text += event.delta;
            deltaEventsEmitted = true;
            await emitAgentEvent(context.toolContext, {
                ...eventBase(context.eventContext, 'agent_message_delta'),
                type: 'agent_message_delta',
                delta: event.delta,
            });
        }
        else {
            completed = true;
            text = event.text;
            toolCalls = event.toolCalls ?? [];
            usage = event.usage;
            raw = event.raw;
        }
    }
    if (context.hasTools && !deltaEventsEmitted && !text && !toolCalls.length) {
        return {
            response: await generateText(request, options),
            deltaEventsEmitted: false,
        };
    }
    return {
        response: {
            provider,
            model,
            text,
            toolCalls,
            usage,
            raw: raw ?? { streamed: true, completed },
        },
        deltaEventsEmitted,
    };
}
function shouldStreamTextResponse(input, model) {
    return input ?? model.provider.capabilities.streaming;
}
function defaultAgentProviderOptions(providerId) {
    if (providerId !== 'minimax-cn')
        return undefined;
    return {
        minimax: {
            thinking: {
                type: 'disabled',
            },
        },
    };
}
function mergeProviderOptions(base, patch) {
    if (!base && !patch)
        return undefined;
    const merged = { ...base };
    for (const [key, value] of Object.entries(patch ?? {})) {
        merged[key] = {
            ...(merged[key] ?? {}),
            ...(value ?? {}),
        };
    }
    return merged;
}
