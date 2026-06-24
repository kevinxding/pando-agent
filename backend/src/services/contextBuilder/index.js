const DEFAULT_MAX_CONTEXT_CHARS = 60_000;
const DEFAULT_MIN_RECENT_MESSAGES = 12;
const DEFAULT_CHECKPOINT_SUMMARY_CHARS = 2_000;
export function buildThreadContext(input) {
    const options = normalizeOptions(input.options);
    const compaction = latestSuccessfulCompaction(input.compactions ?? []);
    const messagesAfterCompaction = compaction
        ? input.messages.slice(Math.min(compaction.coveredMessageCount, input.messages.length))
        : input.messages;
    const sanitized = sanitizeRectangles(buildContextRectangles(messagesAfterCompaction));
    const safeRectangles = sanitized.rectangles;
    const allSafeMessages = safeRectangles.flatMap(rectangle => rectangle.messages);
    const compactionSummaryMessage = compaction ? createCompactionSummaryMessage(compaction) : undefined;
    const fixedSummaryChars = compactionSummaryMessage ? estimateMessages([compactionSummaryMessage]) : 0;
    const allSafeChars = estimateMessages(allSafeMessages) + fixedSummaryChars;
    const selectedRectangles = allSafeChars <= options.maxContextChars
        ? safeRectangles
        : selectRecentContextRectangles(safeRectangles, options.maxContextChars, options.minRecentMessages, fixedSummaryChars);
    const retainedSourceMessages = selectedRectangles.flatMap(rectangle => rectangle.messages);
    const liveDroppedMessageCount = messagesAfterCompaction.length - retainedSourceMessages.length;
    const droppedMessageCount = input.messages.length - retainedSourceMessages.length;
    const contextNotes = [];
    const checkpoint = latestCheckpoint(input.checkpoints ?? []);
    const shouldInsertNote = options.includeContextNote &&
        (liveDroppedMessageCount > 0 || sanitized.orphanedToolResultCount > 0 || sanitized.droppedUnpairedToolCallGroupCount > 0);
    const contextNote = shouldInsertNote
        ? createContextNote({
            droppedMessageCount: liveDroppedMessageCount,
            checkpoint,
            checkpointSummaryChars: options.checkpointSummaryChars,
            orphanedToolResultCount: sanitized.orphanedToolResultCount,
            droppedUnpairedToolCallGroupCount: sanitized.droppedUnpairedToolCallGroupCount,
        })
        : undefined;
    const initialMessages = [
        ...(compactionSummaryMessage ? [compactionSummaryMessage] : []),
        ...(contextNote ? [contextNote] : []),
        ...retainedSourceMessages,
    ];
    if (compactionSummaryMessage) {
        contextNotes.push('Latest compaction summary was included.');
    }
    if (contextNote) {
        contextNotes.push('Earlier conversation history was omitted from this model request.');
        if (checkpoint?.finalTextPreview)
            contextNotes.push('Latest checkpoint preview was included.');
        if (sanitized.orphanedToolResultCount > 0)
            contextNotes.push('Orphaned tool result messages were removed.');
        if (sanitized.droppedUnpairedToolCallGroupCount > 0)
            contextNotes.push('Groups with unpaired tool calls were removed.');
    }
    return {
        initialMessages,
        contextNotes,
        stats: {
            sourceMessageCount: input.messages.length,
            retainedMessageCount: initialMessages.length,
            droppedMessageCount,
            estimatedChars: estimateMessages(initialMessages),
            maxContextChars: options.maxContextChars,
            minRecentMessages: options.minRecentMessages,
            checkpointIncluded: Boolean(contextNote && checkpoint?.finalTextPreview),
            insertedContextNote: Boolean(contextNote),
            orphanedToolResultCount: sanitized.orphanedToolResultCount,
            droppedUnpairedToolCallGroupCount: sanitized.droppedUnpairedToolCallGroupCount,
            compactionSummaryIncluded: Boolean(compactionSummaryMessage),
            compactionId: compaction?.compactionId,
            compactionWindowId: compaction?.windowId,
            compactedMessageCount: compaction?.coveredMessageCount ?? 0,
        },
    };
}
export function estimateMessages(messages) {
    return messages.reduce((total, message) => total + estimateMessage(message), 0);
}
function normalizeOptions(options) {
    return {
        maxContextChars: options?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
        minRecentMessages: options?.minRecentMessages ?? DEFAULT_MIN_RECENT_MESSAGES,
        checkpointSummaryChars: options?.checkpointSummaryChars ?? DEFAULT_CHECKPOINT_SUMMARY_CHARS,
        includeContextNote: options?.includeContextNote ?? true,
    };
}
export function buildContextRectangles(messages) {
    const rectangles = [];
    let current = [];
    let currentStart = 0;
    const unresolvedToolCalls = new Set();
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'user' && current.length > 0 && unresolvedToolCalls.size === 0) {
            rectangles.push(createRectangle(current, currentStart, index));
            current = [];
            currentStart = index;
        }
        current.push(message);
        if (message.role === 'assistant') {
            for (const toolCall of message.toolCalls ?? []) {
                unresolvedToolCalls.add(toolCall.id);
            }
        }
        if (message.role === 'tool' && message.toolCallId) {
            unresolvedToolCalls.delete(message.toolCallId);
        }
    }
    if (current.length > 0)
        rectangles.push(createRectangle(current, currentStart, messages.length));
    return rectangles;
}
export function selectRecentContextRectangles(rectangles, maxContextChars, minRecentMessages, fixedChars = 0) {
    let selectedStart = rectangles.length;
    let retainedMessageCount = 0;
    let retainedChars = fixedChars;
    while (selectedStart > 0 && retainedMessageCount < minRecentMessages) {
        selectedStart -= 1;
        retainedMessageCount += rectangles[selectedStart]?.messages.length ?? 0;
        retainedChars += rectangles[selectedStart]?.estimatedChars ?? 0;
    }
    while (selectedStart > 0) {
        const candidate = rectangles[selectedStart - 1];
        if (!candidate)
            break;
        if (retainedChars + candidate.estimatedChars > maxContextChars)
            break;
        selectedStart -= 1;
        retainedMessageCount += candidate.messages.length;
        retainedChars += candidate.estimatedChars;
    }
    return rectangles.slice(selectedStart);
}
function sanitizeRectangles(rectangles) {
    const safeRectangles = [];
    let orphanedToolResultCount = 0;
    let droppedUnpairedToolCallGroupCount = 0;
    for (const rectangle of rectangles) {
        const sanitized = sanitizeGroup(rectangle.messages);
        orphanedToolResultCount += sanitized.orphanedToolResultCount;
        if (sanitized.droppedForUnpairedToolCalls) {
            droppedUnpairedToolCallGroupCount += 1;
            continue;
        }
        if (sanitized.messages.length > 0) {
            safeRectangles.push({
                ...rectangle,
                messages: sanitized.messages,
                estimatedChars: estimateMessages(sanitized.messages),
            });
        }
    }
    return {
        rectangles: safeRectangles,
        orphanedToolResultCount,
        droppedUnpairedToolCallGroupCount,
    };
}
function sanitizeGroup(group) {
    const requiredToolResults = new Set();
    for (const message of group) {
        if (message.role !== 'assistant')
            continue;
        for (const toolCall of message.toolCalls ?? []) {
            requiredToolResults.add(toolCall.id);
        }
    }
    const seenToolResults = new Set();
    const messages = [];
    let orphanedToolResultCount = 0;
    for (const message of group) {
        if (message.role !== 'tool') {
            messages.push(message);
            continue;
        }
        if (message.toolCallId && requiredToolResults.has(message.toolCallId)) {
            seenToolResults.add(message.toolCallId);
            messages.push(message);
        }
        else {
            orphanedToolResultCount += 1;
        }
    }
    for (const toolCallId of requiredToolResults) {
        if (!seenToolResults.has(toolCallId)) {
            return {
                messages: [],
                orphanedToolResultCount,
                droppedForUnpairedToolCalls: true,
            };
        }
    }
    return {
        messages,
        orphanedToolResultCount,
        droppedForUnpairedToolCalls: false,
    };
}
function createContextNote(input) {
    const lines = [
        '[context note]',
        'Earlier conversation history was omitted from this model request to stay within the context budget.',
        `Dropped historical messages: ${Math.max(0, input.droppedMessageCount)}.`,
    ];
    if (input.orphanedToolResultCount > 0) {
        lines.push(`Removed orphaned tool result messages: ${input.orphanedToolResultCount}.`);
    }
    if (input.droppedUnpairedToolCallGroupCount > 0) {
        lines.push(`Removed historical groups with unpaired tool calls: ${input.droppedUnpairedToolCallGroupCount}.`);
    }
    if (input.checkpoint?.finalTextPreview) {
        lines.push('Latest checkpoint preview:');
        lines.push(truncateText(input.checkpoint.finalTextPreview, input.checkpointSummaryChars));
    }
    lines.push('[/context note]');
    return {
        role: 'user',
        content: lines.join('\n'),
    };
}
function createCompactionSummaryMessage(compaction) {
    return {
        role: 'user',
        content: [
            '[compaction summary]',
            `compactionId: ${compaction.compactionId}`,
            `windowId: ${compaction.windowId}`,
            compaction.summary,
            '[/compaction summary]',
        ].join('\n'),
    };
}
function latestCheckpoint(checkpoints) {
    return checkpoints[checkpoints.length - 1];
}
function latestSuccessfulCompaction(compactions) {
    for (let index = compactions.length - 1; index >= 0; index -= 1) {
        const compaction = compactions[index];
        if (compaction?.status === 'completed')
            return compaction;
    }
    return undefined;
}
function createRectangle(messages, startIndex, endIndex) {
    return {
        messages: [...messages],
        startIndex,
        endIndex,
        estimatedChars: estimateMessages(messages),
    };
}
function estimateMessage(message) {
    const toolCalls = message.toolCalls?.length ? JSON.stringify(message.toolCalls).length : 0;
    return message.role.length + message.content.length + (message.toolCallId?.length ?? 0) + toolCalls + 16;
}
function truncateText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}
