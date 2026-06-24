import { resolveDefaultModel } from '../config/index.js';
import { buildContextRectangles, estimateMessages, selectRecentContextRectangles, } from '../contextBuilder/index.js';
import { eventBase } from '../events/index.js';
import { generateText } from '../llm/client.js';
import { modelMetadata, } from '../threadStore/index.js';
export const DEFAULT_AUTO_COMPACT_THRESHOLD_RATIO = 0.85;
export const DEFAULT_AUTO_COMPACT_TARGET_RATIO = 0.55;
export const DEFAULT_AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_MAX_CONTEXT_CHARS = 60_000;
const DEFAULT_MIN_RECENT_MESSAGES = 12;
const DEFAULT_MAX_SUMMARY_CHARS = 12_000;
export function shouldAutoCompactThread(input) {
    const maxContextChars = input.context?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const thresholdRatio = input.autoCompact?.thresholdRatio ?? DEFAULT_AUTO_COMPACT_THRESHOLD_RATIO;
    const targetRatio = input.autoCompact?.targetRatio ?? DEFAULT_AUTO_COMPACT_TARGET_RATIO;
    const latest = latestSuccessfulCompaction(input.compactions ?? []);
    const activeMessages = latest
        ? [
            compactionSummaryMessage(latest),
            ...input.messages.slice(Math.min(latest.coveredMessageCount, input.messages.length)),
        ]
        : [...input.messages];
    if (input.pendingPrompt)
        activeMessages.push({ role: 'user', content: input.pendingPrompt });
    const estimatedChars = estimateMessages(activeMessages);
    const thresholdChars = Math.floor(maxContextChars * thresholdRatio);
    const targetContextChars = Math.floor(maxContextChars * targetRatio);
    return {
        shouldCompact: input.autoCompact?.enabled !== false && estimatedChars >= thresholdChars,
        estimatedChars,
        maxContextChars,
        thresholdChars,
        targetContextChars,
    };
}
export async function compactThreadHistory(input) {
    const messages = await input.store.readMessages(input.threadId);
    const compactions = await input.store.readCompactions(input.threadId);
    const latest = latestSuccessfulCompaction(compactions);
    const windowId = await input.store.nextCompactionWindowId(input.threadId);
    const compactionId = `compaction_${Date.now()}_${shortId()}`;
    const targetContextChars = Math.floor((input.context?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS) * DEFAULT_AUTO_COMPACT_TARGET_RATIO);
    const minRecentMessages = input.context?.minRecentMessages ?? DEFAULT_MIN_RECENT_MESSAGES;
    const plan = planCompaction({
        messages,
        latest,
        targetContextChars,
        minRecentMessages,
    });
    await input.emitEvent?.({
        ...eventBase({ sessionId: input.sessionId }, 'compaction_started'),
        type: 'compaction_started',
        threadId: input.threadId,
        compactionId,
        trigger: input.trigger,
        reason: input.reason,
        phase: input.phase,
        windowId,
        sourceMessageCount: messages.length,
        targetContextChars,
    });
    const model = resolveDefaultModel(input.config ?? {});
    try {
        const response = await generateText({
            model,
            system: compactSystemPrompt(input.system),
            prompt: compactPrompt({
                previousSummary: latest?.summary,
                messages: plan.messagesToSummarize,
            }),
            temperature: 0,
            maxTokens: 1024,
        }, {
            fetch: input.fetch,
            retry: false,
        });
        const summary = normalizeSummary(response.text);
        const compaction = {
            compactionId,
            threadId: input.threadId,
            sessionId: input.sessionId,
            createdAtMs: Date.now(),
            trigger: input.trigger,
            reason: input.reason,
            phase: input.phase,
            windowId,
            sourceMessageCount: messages.length,
            coveredMessageCount: plan.coveredMessageCount,
            retainedMessageCount: messages.length - plan.coveredMessageCount,
            summary,
            summaryChars: summary.length,
            inputEstimatedChars: plan.inputEstimatedChars,
            outputModel: modelMetadata(model),
            status: 'completed',
        };
        await input.store.appendCompaction(input.threadId, compaction);
        await input.emitEvent?.({
            ...eventBase({ sessionId: input.sessionId }, 'compaction_completed'),
            type: 'compaction_completed',
            threadId: input.threadId,
            compactionId,
            windowId,
            coveredMessageCount: compaction.coveredMessageCount,
            retainedMessageCount: compaction.retainedMessageCount,
            summaryChars: compaction.summaryChars,
            inputEstimatedChars: compaction.inputEstimatedChars,
            outputModel: compaction.outputModel,
        });
        return compaction;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const compaction = {
            compactionId,
            threadId: input.threadId,
            sessionId: input.sessionId,
            createdAtMs: Date.now(),
            trigger: input.trigger,
            reason: input.reason,
            phase: input.phase,
            windowId,
            sourceMessageCount: messages.length,
            coveredMessageCount: plan.coveredMessageCount,
            retainedMessageCount: messages.length - plan.coveredMessageCount,
            summary: '',
            summaryChars: 0,
            inputEstimatedChars: plan.inputEstimatedChars,
            outputModel: modelMetadata(model),
            status: 'failed',
        };
        await input.store.appendCompaction(input.threadId, compaction);
        await input.emitEvent?.({
            ...eventBase({ sessionId: input.sessionId }, 'compaction_failed'),
            type: 'compaction_failed',
            threadId: input.threadId,
            compactionId,
            windowId,
            message,
        });
        throw error;
    }
}
export function isContextLengthError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /context|prompt|token|too\s*long|maximum context|context_length|context window/i.test(message);
}
function planCompaction(input) {
    const baseCoveredMessageCount = Math.min(input.latest?.coveredMessageCount ?? 0, input.messages.length);
    const messagesAfterLatest = input.messages.slice(baseCoveredMessageCount);
    const fixedChars = input.latest ? estimateMessages([compactionSummaryMessage(input.latest)]) : 0;
    const rectangles = buildContextRectangles(messagesAfterLatest);
    const retainedRectangles = selectRecentContextRectangles(rectangles, input.targetContextChars, input.minRecentMessages, fixedChars);
    const additionalCoveredMessageCount = retainedRectangles[0]?.startIndex ?? messagesAfterLatest.length;
    if (additionalCoveredMessageCount <= 0) {
        throw new Error('Thread does not have enough compactable history yet');
    }
    const coveredMessageCount = baseCoveredMessageCount + additionalCoveredMessageCount;
    const messagesToSummarize = input.messages.slice(baseCoveredMessageCount, coveredMessageCount);
    return {
        coveredMessageCount,
        messagesToSummarize,
        inputEstimatedChars: estimateMessages(messagesToSummarize) + (input.latest?.summary.length ?? 0),
    };
}
function compactSystemPrompt(existingSystem) {
    const parts = [
        'You compact an agent conversation into a durable working summary.',
        'Preserve user goals, decisions, constraints, file paths, commands, tool results, open questions, and next steps.',
        'Do not include secrets, API keys, tokens, or passwords.',
        'Write concise plain text that can replace earlier conversation history.',
    ];
    if (existingSystem) {
        parts.push('Current system instructions for context only:');
        parts.push(existingSystem);
    }
    return parts.join('\n');
}
function compactPrompt(input) {
    const lines = ['Summarize the following earlier conversation history for future turns.'];
    if (input.previousSummary) {
        lines.push('', 'Previous compaction summary:', redactSensitiveText(input.previousSummary));
    }
    lines.push('', 'Messages to compact:');
    input.messages.forEach((message, index) => {
        lines.push(`\n[${index + 1}] role=${message.role}`);
        if (message.toolCallId)
            lines.push(`toolCallId=${message.toolCallId}`);
        if (message.toolCalls?.length) {
            lines.push(`toolCalls=${message.toolCalls.map(toolCall => `${toolCall.name}:${toolCall.id}`).join(', ')}`);
        }
        lines.push(redactSensitiveText(message.content || '(empty)'));
    });
    return lines.join('\n');
}
function normalizeSummary(text) {
    const trimmed = redactSensitiveText(text.trim());
    if (!trimmed)
        return 'Earlier conversation was compacted, but the summarizer returned no text.';
    return trimmed.length <= DEFAULT_MAX_SUMMARY_CHARS
        ? trimmed
        : `${trimmed.slice(0, DEFAULT_MAX_SUMMARY_CHARS)}\n[truncated ${trimmed.length - DEFAULT_MAX_SUMMARY_CHARS} chars]`;
}
function compactionSummaryMessage(compaction) {
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
function latestSuccessfulCompaction(compactions) {
    for (let index = compactions.length - 1; index >= 0; index -= 1) {
        const compaction = compactions[index];
        if (compaction?.status === 'completed')
            return compaction;
    }
    return undefined;
}
function redactSensitiveText(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/g, 'Bearer <redacted>')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '<redacted>')
        .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>');
}
function shortId() {
    return Math.random().toString(36).slice(2, 10);
}
