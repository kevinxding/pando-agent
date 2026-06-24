export function openAIResponsesPath(baseURL) {
    return `${trimTrailingSlash(baseURL)}/responses`;
}
export function buildOpenAIResponsesBody(request) {
    const provider = request.model.provider;
    return compactObject({
        ...provider.defaultBody,
        model: request.model.model ?? provider.defaultModel,
        input: buildInput(request),
        tools: buildTools(request.tools),
        tool_choice: request.toolChoice,
        stream: request.stream ?? false,
        temperature: request.temperature,
        top_p: request.topP,
        max_output_tokens: request.maxTokens,
        ...providerOptions(request, provider),
    });
}
export function parseOpenAIResponsesText(raw) {
    const response = raw;
    if (typeof response.output_text === 'string')
        return response.output_text;
    const parts = [];
    for (const item of response.output ?? []) {
        for (const content of item.content ?? []) {
            if (typeof content.text === 'string')
                parts.push(content.text);
        }
    }
    return parts.join('');
}
export function parseOpenAIResponsesToolCalls(raw) {
    const response = raw;
    return (response.output ?? []).flatMap((item, index) => {
        if (item.type !== 'function_call' && item.type !== 'custom_tool_call')
            return [];
        const name = item.name;
        if (typeof name !== 'string' || !name)
            return [];
        const rawInput = stringifyToolInput(item.arguments ?? item.input);
        return [
            {
                id: typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_${index}`,
                name,
                input: parseToolInput(rawInput),
                rawInput,
            },
        ];
    });
}
export function parseOpenAIResponsesUsage(raw) {
    return raw.usage;
}
function buildInput(request) {
    const input = [];
    if (request.system) {
        input.push({ role: 'system', content: request.system });
    }
    for (const message of request.messages ?? []) {
        for (const toolCall of message.toolCalls ?? []) {
            input.push({
                type: 'function_call',
                call_id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.rawInput ?? JSON.stringify(toolCall.input),
            });
        }
        if (message.role === 'tool') {
            if (message.toolCallId) {
                input.push({
                    type: 'function_call_output',
                    call_id: message.toolCallId,
                    output: contentToText(message.content),
                });
            }
            continue;
        }
        input.push({ role: message.role, content: message.content });
    }
    if (request.prompt !== undefined) {
        input.push({ role: 'user', content: request.prompt });
    }
    return input;
}
function buildTools(tools) {
    if (!tools?.length)
        return undefined;
    return tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? defaultInputSchema(),
    }));
}
function providerOptions(request, provider) {
    const merged = {};
    for (const key of ['openaiResponses', provider.id, ...(provider.optionKeys ?? [])]) {
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
