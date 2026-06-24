export function openAIChatPath(baseURL) {
    return `${trimTrailingSlash(baseURL)}/chat/completions`;
}
export function buildOpenAIChatBody(request) {
    const provider = request.model.provider;
    return compactObject({
        ...provider.defaultBody,
        model: request.model.model ?? provider.defaultModel,
        messages: buildMessages(request),
        tools: buildTools(request.tools),
        tool_choice: request.toolChoice,
        stream: request.stream ?? false,
        temperature: request.temperature,
        top_p: request.topP,
        max_completion_tokens: request.maxTokens,
        stop: request.stop,
        ...providerOptions(request, provider),
    });
}
export function parseOpenAIChatText(raw) {
    const response = raw;
    const first = response.choices?.[0];
    const content = first?.message?.content ?? first?.delta?.content;
    return typeof content === 'string' ? content : '';
}
export function parseOpenAIChatToolCalls(raw) {
    const response = raw;
    const toolCalls = response.choices?.[0]?.message?.tool_calls ?? [];
    return toolCalls.flatMap((toolCall, index) => {
        const name = toolCall.function?.name;
        if (typeof name !== 'string' || !name)
            return [];
        const rawInput = stringifyToolInput(toolCall.function?.arguments);
        return [
            {
                id: typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : `call_${index}`,
                name,
                input: parseToolInput(rawInput),
                rawInput,
            },
        ];
    });
}
export function parseOpenAIChatUsage(raw) {
    return raw.usage;
}
function buildMessages(request) {
    const messages = [];
    if (request.system) {
        messages.push({ role: 'system', content: request.system });
    }
    messages.push(...(request.messages ?? []));
    if (request.prompt !== undefined) {
        messages.push({ role: 'user', content: request.prompt });
    }
    return messages.map(buildMessage);
}
function buildMessage(message) {
    if (message.role === 'tool') {
        return compactObject({
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: contentToText(message.content),
        });
    }
    return compactObject({
        role: message.role,
        content: message.content,
        name: message.name,
        tool_calls: buildToolCalls(message.toolCalls),
    });
}
function buildToolCalls(toolCalls) {
    if (!toolCalls?.length)
        return undefined;
    return toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
            name: toolCall.name,
            arguments: toolCall.rawInput ?? JSON.stringify(toolCall.input),
        },
    }));
}
function buildTools(tools) {
    if (!tools?.length)
        return undefined;
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema ?? defaultInputSchema(),
        },
    }));
}
function providerOptions(request, provider) {
    const merged = {};
    for (const key of ['openaiCompatible', provider.id, ...(provider.optionKeys ?? [])]) {
        const value = request.providerOptions?.[key];
        if (!value)
            continue;
        Object.assign(merged, value);
    }
    return merged;
}
function compactObject(input) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
function defaultInputSchema() {
    return {
        type: 'object',
        properties: {},
        additionalProperties: true,
    };
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
function contentToText(content) {
    if (typeof content === 'string')
        return content;
    return content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('');
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
}
