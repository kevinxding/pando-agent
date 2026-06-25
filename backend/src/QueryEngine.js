import { runQueryTurn } from './query.js';
import { AgentSession } from './services/agent/index.js';
import { resolveDefaultModel } from './services/config/index.js';
import { buildThreadContext, } from './services/contextBuilder/index.js';
import { compactThreadHistory, DEFAULT_AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES, isContextLengthError, shouldAutoCompactThread, } from './services/compact/index.js';
import { createEventRecorder, eventBase, previewText, } from './services/events/index.js';
import { buildTokenBudgetContext } from './services/tokenBudget/index.js';
import { LocalThreadStore, modelMetadata, } from './services/threadStore/index.js';
import { createDefaultToolRegistry } from './tools.js';
import { createAbortController } from './utils/abortController.js';
export class QueryEngine {
    options;
    registry;
    agentSession;
    context;
    maxToolRounds;
    mutableMessages = [];
    toolResults = [];
    eventRecorder;
    threadStore;
    threadMetadata;
    effectiveConfig;
    persistedMessages = [];
    lastPersistedAgentMessageCount = 0;
    lastContextStats;
    writeAheadUserMessage;
    activePrompt;
    initializePromise;
    inProgressToolUseIds = new Set();
    abortController;
    consecutiveAutoCompactFailures = 0;
    constructor(options) {
        this.options = options;
        this.registry = options.registry ?? createDefaultToolRegistry();
        this.maxToolRounds = options.maxToolRounds;
        this.abortController = createAbortController();
    }
    async submitMessage(prompt) {
        await this.ensureInitialized();
        if (!this.context || !this.threadStore || !this.threadMetadata) {
            throw new Error('QueryEngine failed to initialize');
        }
        this.writeAheadUserMessage = undefined;
        this.activePrompt = prompt;
        const run = await this.startRun(prompt);
        if (this.context)
            this.context.runId = run.runId;
        if (this.options.persistUserMessage !== false) {
            await this.persistWriteAheadUserMessage(prompt);
        }
        let output;
        try {
            await this.maybeAutoCompact(prompt);
            await this.prepareAgentSession();
            if (!this.agentSession) {
                throw new Error('QueryEngine failed to prepare an agent session');
            }
            this.mutableMessages.push(prompt);
            const eventStartIndex = this.events().length;
            output = await this.runPreparedTurn(prompt);
            await this.persistTurn(output);
            await this.completeRun(run, output);
            return output;
        }
        catch (error) {
            try {
                const eventStartIndex = this.events().findIndex(event => event.type === 'run_started' && event.runId === run.runId);
                const startIndex = eventStartIndex >= 0 ? eventStartIndex : 0;
                if (await this.maybeReactiveCompactAndRetry(prompt, error, startIndex)) {
                    if (!this.agentSession)
                        throw new Error('QueryEngine failed to prepare an agent session after compaction');
                    output = await this.runPreparedTurn(prompt);
                    await this.persistTurn(output);
                    await this.completeRun(run, output);
                    return output;
                }
            }
            catch (retryError) {
                await this.failRun(run, retryError);
                throw retryError;
            }
            await this.failRun(run, error);
            throw error;
        }
    }
    run(prompt) {
        return this.submitMessage(prompt);
    }
    events() {
        return this.eventRecorder?.events ?? [];
    }
    threadId() {
        return this.threadMetadata?.threadId;
    }
    metadata() {
        return this.threadMetadata;
    }
    abort(reason) {
        this.abortController.abort(reason);
    }
    async ensureInitialized() {
        this.initializePromise ??= this.initialize();
        await this.initializePromise;
    }
    async initialize() {
        this.threadStore = new LocalThreadStore(this.options.cwd);
        const record = await this.resolveThreadRecord(this.threadStore);
        this.persistedMessages = await this.threadStore.readMessages(record.metadata.threadId);
        const effectiveConfig = configWithThreadMetadata(this.options.config, record.metadata, this.options.modelOverride);
        const model = resolveDefaultModel(effectiveConfig);
        this.threadMetadata = record.metadata;
        this.effectiveConfig = effectiveConfig;
        this.eventRecorder = createEventRecorder(async (event) => {
            if (!this.threadStore || !this.threadMetadata)
                return;
            const linkedEvent = this.threadMetadata.goalId && !event.goalId
                ? { ...event, goalId: this.threadMetadata.goalId }
                : event;
            await this.threadStore.appendEvent(this.threadMetadata.threadId, linkedEvent);
            await this.options.onEvent?.(linkedEvent);
        });
        this.context = {
            cwd: record.metadata.cwd,
            sessionId: this.options.sessionId,
            threadId: record.metadata.threadId,
            permissionMode: 'default',
            permissions: effectiveConfig.permissions,
            toolResultStorage: this.options.toolResultStorage,
            requestToolApproval: this.options.requestToolApproval,
            emitEvent: this.eventRecorder.emitEvent,
            abortSignal: this.abortController.signal,
            inProgressToolUseIds: this.inProgressToolUseIds,
            markToolInProgress: id => this.inProgressToolUseIds.add(id),
            markToolComplete: id => this.inProgressToolUseIds.delete(id),
            recordToolResult: result => this.toolResults.push(result.content),
            metadata: {
                ...(this.options.metadata ?? {}),
                goalId: record.metadata.goalId,
            },
        };
        if (!record.metadata.model) {
            this.threadMetadata = {
                ...record.metadata,
                model: modelMetadata(model),
            };
            await this.threadStore.writeMetadata(this.threadMetadata);
        }
    }
    async prepareAgentSession() {
        if (!this.threadStore || !this.threadMetadata || !this.effectiveConfig || !this.eventRecorder) {
            throw new Error('QueryEngine failed to initialize context builder');
        }
        const checkpoints = await this.threadStore.readCheckpoints(this.threadMetadata.threadId);
        const compactions = await this.threadStore.readCompactions(this.threadMetadata.threadId);
        const context = buildThreadContext({
            messages: this.persistedMessages,
            checkpoints,
            compactions,
            options: this.options.context,
        });
        const model = resolveDefaultModel(this.effectiveConfig);
        const tokenBudget = buildTokenBudgetContext({
            messages: context.initialMessages,
            model,
            threadId: this.threadMetadata.threadId,
            windowId: context.stats.compactionWindowId,
            config: this.effectiveConfig,
            options: this.options.tokenBudget,
            reserveOutputTokens: this.options.maxTokens,
        });
        const initialMessages = [
            ...(tokenBudget.message ? [tokenBudget.message] : []),
            ...context.initialMessages,
        ];
        this.lastContextStats = {
            ...context.stats,
            tokenBudget: tokenBudget.stats,
        };
        this.lastPersistedAgentMessageCount = initialMessages.length;
        this.agentSession = new AgentSession({
            config: this.effectiveConfig,
            system: this.options.system,
            maxTokens: this.options.maxTokens,
            temperature: this.options.temperature,
            fetch: this.options.fetch,
            initialMessages,
        });
        await this.eventRecorder.emitEvent({
            ...eventBase({ sessionId: this.options.sessionId }, 'context_built'),
            type: 'context_built',
            threadId: this.threadMetadata.threadId,
            sourceMessageCount: context.stats.sourceMessageCount,
            retainedMessageCount: context.stats.retainedMessageCount,
            droppedMessageCount: context.stats.droppedMessageCount,
            estimatedChars: context.stats.estimatedChars,
            maxContextChars: context.stats.maxContextChars,
            checkpointIncluded: context.stats.checkpointIncluded,
            insertedContextNote: context.stats.insertedContextNote,
            orphanedToolResultCount: context.stats.orphanedToolResultCount,
            droppedUnpairedToolCallGroupCount: context.stats.droppedUnpairedToolCallGroupCount,
            compactionSummaryIncluded: context.stats.compactionSummaryIncluded,
            compactionId: context.stats.compactionId,
            compactionWindowId: context.stats.compactionWindowId,
            compactedMessageCount: context.stats.compactedMessageCount,
            tokenBudget: tokenBudget.stats,
            contextNotes: context.contextNotes,
        });
    }
    runPreparedTurn(prompt) {
        if (!this.context || !this.agentSession) {
            throw new Error('QueryEngine failed to prepare turn execution');
        }
        return runQueryTurn({
            prompt,
            registry: this.registry,
            context: this.context,
            agentSession: this.agentSession,
            maxToolRounds: this.maxToolRounds,
        });
    }
    async maybeAutoCompact(prompt) {
        if (!this.threadStore || !this.threadMetadata || !this.effectiveConfig || !this.eventRecorder) {
            throw new Error('QueryEngine failed to initialize auto compact');
        }
        const maxFailures = this.options.autoCompact?.maxConsecutiveFailures ?? DEFAULT_AUTO_COMPACT_MAX_CONSECUTIVE_FAILURES;
        if (this.options.autoCompact?.enabled === false || this.consecutiveAutoCompactFailures >= maxFailures)
            return;
        const compactions = await this.threadStore.readCompactions(this.threadMetadata.threadId);
        const decision = shouldAutoCompactThread({
            messages: this.persistedMessages,
            compactions,
            pendingPrompt: prompt,
            context: this.options.context,
            autoCompact: this.options.autoCompact,
        });
        if (!decision.shouldCompact)
            return;
        try {
            await compactThreadHistory({
                store: this.threadStore,
                threadId: this.threadMetadata.threadId,
                sessionId: this.options.sessionId,
                config: this.effectiveConfig,
                system: this.options.system,
                fetch: this.options.fetch,
                context: this.options.context,
                trigger: 'auto',
                reason: 'context_limit',
                phase: 'pre_turn',
                emitEvent: this.eventRecorder.emitEvent,
            });
            this.consecutiveAutoCompactFailures = 0;
        }
        catch {
            this.consecutiveAutoCompactFailures += 1;
        }
    }
    async maybeReactiveCompactAndRetry(prompt, error, eventStartIndex) {
        if (!this.threadStore || !this.threadMetadata || !this.effectiveConfig || !this.eventRecorder)
            return false;
        if (!isContextLengthError(error))
            return false;
        const eventsAfterStart = this.events().slice(eventStartIndex);
        const toolAlreadyRan = eventsAfterStart.some(event => event.type === 'tool_call_started' || event.type === 'tool_call_completed' || event.type === 'tool_result');
        if (toolAlreadyRan)
            return false;
        try {
            await compactThreadHistory({
                store: this.threadStore,
                threadId: this.threadMetadata.threadId,
                sessionId: this.options.sessionId,
                config: this.effectiveConfig,
                system: this.options.system,
                fetch: this.options.fetch,
                context: this.options.context,
                trigger: 'auto',
                reason: 'retry_after_failure',
                phase: 'retry',
                emitEvent: this.eventRecorder.emitEvent,
            });
            await this.prepareAgentSession();
            return true;
        }
        catch {
            return false;
        }
    }
    async resolveThreadRecord(store) {
        if (!this.options.newThread && this.options.threadId) {
            return store.openThread(this.options.threadId, this.options.sessionId);
        }
        if (!this.options.newThread && this.options.resumeLast) {
            const last = await store.openLastThread(this.options.sessionId);
            if (last)
                return last;
        }
        const model = resolveDefaultModel(applyModelOverride(this.options.config ?? {}, this.options.modelOverride));
        return store.createThread({
            threadId: this.options.newThread ? undefined : this.options.threadId,
            sessionId: this.options.sessionId,
            title: this.options.title,
            cwd: this.options.cwd,
            model: modelMetadata(model),
            permissions: this.options.config?.permissions,
            goalId: this.options.goalId,
        });
    }
    async startRun(prompt) {
        if (!this.threadStore || !this.threadMetadata)
            throw new Error('QueryEngine failed to initialize run ledger');
        const now = Date.now();
        const run = {
            runId: `run_${now}_${Math.random().toString(36).slice(2, 10)}`,
            startedAtMs: now,
            promptPreview: previewText(prompt, 500),
            startResourceUsage: resourceUsageSnapshot(),
        };
        await this.eventRecorder?.emitEvent({
            ...eventBase({ sessionId: this.options.sessionId }, 'run_started'),
            type: 'run_started',
            threadId: this.threadMetadata.threadId,
            runId: run.runId,
            cwd: this.threadMetadata.cwd,
            promptPreview: run.promptPreview,
        });
        await this.threadStore.appendRunLedger({
            ...this.baseRunLedgerEntry(run, 'started', now),
            eventCount: this.events().length,
            messageCount: this.persistedMessages.length,
            resourceUsage: run.startResourceUsage,
        });
        return run;
    }
    async completeRun(run, output) {
        if (!this.threadStore || !this.threadMetadata)
            return;
        const now = Date.now();
        const stats = runStats(this.events(), output, this.persistedMessages.length);
        const resourceUsage = resourceUsageSnapshot();
        await this.eventRecorder?.emitEvent({
            ...eventBase({ sessionId: this.options.sessionId }, 'run_completed'),
            type: 'run_completed',
            threadId: this.threadMetadata.threadId,
            runId: run.runId,
            ok: true,
            finalTextPreview: previewText(output.finalText, 500),
            durationMs: now - run.startedAtMs,
            eventCount: this.events().length + 1,
            messageCount: this.persistedMessages.length,
            toolCallCount: stats.toolCallCount,
            toolResultCount: stats.toolResultCount,
            failedToolResultCount: stats.failedToolResultCount,
            approvalRequestCount: stats.approvalRequestCount,
            resourceUsage,
        });
        await this.threadStore.appendRunLedger({
            ...this.baseRunLedgerEntry(run, 'completed', now),
            completedAtMs: now,
            durationMs: now - run.startedAtMs,
            finalTextPreview: previewText(output.finalText, 500),
            eventCount: this.events().length,
            messageCount: this.persistedMessages.length,
            toolCallCount: stats.toolCallCount,
            toolResultCount: stats.toolResultCount,
            failedToolResultCount: stats.failedToolResultCount,
            approvalRequestCount: stats.approvalRequestCount,
            resourceUsage,
        });
        await this.accountGoalProgress(run, output, now);
    }
    async accountGoalProgress(run, output, completedAtMs) {
        if (!this.threadStore || !this.threadMetadata)
            return;
        const goal = await this.threadStore.accountThreadGoalUsage(this.threadMetadata.threadId, {
            tokenDelta: estimateOutputTokens(output),
            timeDeltaSeconds: Math.ceil((completedAtMs - run.startedAtMs) / 1000),
        });
        if (!goal)
            return;
        this.threadMetadata = await this.threadStore.readMetadata(this.threadMetadata.threadId);
        await this.eventRecorder?.emitEvent({
            ...eventBase({ sessionId: this.options.sessionId }, 'goal_updated'),
            type: 'goal_updated',
            threadId: this.threadMetadata.threadId,
            goal,
        });
    }
    async failRun(run, error) {
        if (!this.threadStore || !this.threadMetadata)
            return;
        const now = Date.now();
        const message = error instanceof Error ? error.message : String(error);
        await this.persistFailedTurn(message);
        const stats = runStats(this.events(), undefined, this.persistedMessages.length);
        const resourceUsage = resourceUsageSnapshot();
        await this.eventRecorder?.emitEvent({
            ...eventBase({ sessionId: this.options.sessionId }, 'run_failed'),
            type: 'run_failed',
            threadId: this.threadMetadata.threadId,
            runId: run.runId,
            ok: false,
            message,
            durationMs: now - run.startedAtMs,
            eventCount: this.events().length + 1,
            toolCallCount: stats.toolCallCount,
            toolResultCount: stats.toolResultCount,
            failedToolResultCount: stats.failedToolResultCount,
            approvalRequestCount: stats.approvalRequestCount,
            resourceUsage,
        });
        await this.threadStore.appendRunLedger({
            ...this.baseRunLedgerEntry(run, 'failed', now),
            completedAtMs: now,
            durationMs: now - run.startedAtMs,
            errorMessage: message,
            eventCount: this.events().length,
            messageCount: this.persistedMessages.length,
            toolCallCount: stats.toolCallCount,
            toolResultCount: stats.toolResultCount,
            failedToolResultCount: stats.failedToolResultCount,
            approvalRequestCount: stats.approvalRequestCount,
            resourceUsage,
        });
    }
    baseRunLedgerEntry(run, status, updatedAtMs) {
        if (!this.threadMetadata)
            throw new Error('QueryEngine failed to initialize run ledger metadata');
        return {
            runId: run.runId,
            sessionId: this.options.sessionId,
            threadId: this.threadMetadata.threadId,
            cwd: this.threadMetadata.cwd,
            status,
            startedAtMs: run.startedAtMs,
            updatedAtMs,
            model: this.threadMetadata.model,
            promptPreview: run.promptPreview,
            eventCount: 0,
            toolCallCount: 0,
            toolResultCount: 0,
            failedToolResultCount: 0,
            approvalRequestCount: 0,
        };
    }
    async persistWriteAheadUserMessage(prompt) {
        if (!this.threadStore || !this.threadMetadata)
            return;
        const message = {
            id: createMessageId(),
            role: 'user',
            content: prompt,
            createdAtMs: Date.now(),
            status: 'submitted',
        };
        await this.threadStore.appendMessage(this.threadMetadata.threadId, message);
        this.writeAheadUserMessage = message;
    }
    normalizeNewMessagesWithWriteAhead(messages) {
        if (!this.writeAheadUserMessage)
            return messages;
        let replaced = false;
        const normalized = messages.map(message => {
            if (!replaced && message.role === 'user' && message.content === this.writeAheadUserMessage?.content) {
                replaced = true;
                return {
                    ...message,
                    ...this.writeAheadUserMessage,
                };
            }
            return message;
        });
        return replaced ? normalized : [this.writeAheadUserMessage, ...normalized];
    }
    messagesNotAlreadyAppended(messages) {
        if (!this.writeAheadUserMessage)
            return messages;
        let dropped = false;
        return messages.filter(message => {
            if (!dropped && message.role === 'user' && message.id === this.writeAheadUserMessage?.id) {
                dropped = true;
                return false;
            }
            return true;
        });
    }
    filterInternalPromptMessage(messages) {
        if (this.options.persistUserMessage !== false || !this.activePrompt)
            return messages;
        let dropped = false;
        return messages.filter(message => {
            if (!dropped && message.role === 'user' && message.content === this.activePrompt) {
                dropped = true;
                return false;
            }
            return true;
        });
    }
    async appendMessages(threadId, messages) {
        for (const message of messages) {
            await this.threadStore?.appendMessage(threadId, message);
        }
    }
    async persistFailedTurn(errorMessage) {
        if (!this.threadStore || !this.threadMetadata)
            return;
        const newMessages = this.filterInternalPromptMessage(this.normalizeNewMessagesWithWriteAhead(this.agentSession?.messages.slice(this.lastPersistedAgentMessageCount) ?? []));
        const assistantMessage = {
            id: createMessageId(),
            role: 'assistant',
            content: failureAssistantContent(errorMessage),
            createdAtMs: Date.now(),
            status: 'failed',
            errorMessage: previewText(errorMessage, 500),
        };
        const messagesToAppend = [...this.messagesNotAlreadyAppended(newMessages), assistantMessage];
        this.persistedMessages = [...this.persistedMessages, ...newMessages, assistantMessage];
        await this.appendMessages(this.threadMetadata.threadId, messagesToAppend);
        this.writeAheadUserMessage = undefined;
        this.threadMetadata = await this.threadStore.readMetadata(this.threadMetadata.threadId);
    }
    async persistTurn(output) {
        if (!this.threadStore || !this.threadMetadata || !output.agent)
            return;
        const newMessages = this.filterInternalPromptMessage(this.normalizeNewMessagesWithWriteAhead(output.agent.messages.slice(this.lastPersistedAgentMessageCount)));
        const messagesToAppend = this.messagesNotAlreadyAppended(newMessages);
        this.persistedMessages = [...this.persistedMessages, ...newMessages];
        await this.appendMessages(this.threadMetadata.threadId, messagesToAppend);
        this.writeAheadUserMessage = undefined;
        await this.threadStore.appendCheckpoint(this.threadMetadata.threadId, this.threadStore.createCheckpoint({
            metadata: this.threadMetadata,
            turnId: latestTurnId(this.events()),
            messageCount: this.persistedMessages.length,
            eventCount: this.events().length,
            finalText: output.finalText,
            context: this.lastContextStats,
        }));
        this.threadMetadata = await this.threadStore.readMetadata(this.threadMetadata.threadId);
    }
}
function createMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function failureAssistantContent(errorMessage) {
    if (/abort|aborted|stopped_by_user|stop/i.test(errorMessage))
        return 'Task stopped.';
    return 'Backend or model request failed. Please check Pando backend status and try again.';
}
function estimateOutputTokens(output) {
    const usage = output?.usage ?? output?.response?.usage;
    const explicit = numericUsage(usage?.totalTokens) ??
        numericUsage(usage?.total_tokens) ??
        numericUsage(usage?.outputTokens) ??
        numericUsage(usage?.output_tokens) ??
        numericUsage(usage?.completionTokens) ??
        numericUsage(usage?.completion_tokens);
    if (explicit !== undefined)
        return explicit;
    return Math.ceil(String(output?.finalText ?? '').length / 4);
}
function numericUsage(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}
function runStats(events, output, messageCount) {
    if (output) {
        const toolResults = output.toolResults;
        return {
            messageCount,
            toolCallCount: output.agent?.toolCalls.length ?? events.filter(event => event.type === 'tool_call_started').length,
            toolResultCount: toolResults.length,
            failedToolResultCount: toolResults.filter(result => !result.ok).length,
            approvalRequestCount: events.filter(event => event.type === 'approval_requested').length,
        };
    }
    return {
        messageCount,
        toolCallCount: events.filter(event => event.type === 'tool_call_started').length,
        toolResultCount: events.filter(event => event.type === 'tool_result').length,
        failedToolResultCount: events.filter(event => event.type === 'tool_result' && !event.ok).length,
        approvalRequestCount: events.filter(event => event.type === 'approval_requested').length,
    };
}
function resourceUsageSnapshot() {
    const runtime = globalThis;
    const usage = typeof runtime.process?.memoryUsage === 'function'
        ? runtime.process.memoryUsage()
        : {
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: undefined,
            arrayBuffers: undefined,
        };
    return {
        rssBytes: usage.rss,
        heapTotalBytes: usage.heapTotal,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers,
    };
}
function configWithThreadMetadata(config, metadata, modelOverride) {
    const metadataConfig = {
        ...(config ?? {}),
        model: metadata.model
            ? {
                ...(config?.model ?? {}),
                provider: metadata.model.provider,
                name: metadata.model.name,
            }
            : config?.model,
        permissions: metadata.permissions ?? config?.permissions,
    };
    return applyModelOverride(metadataConfig, modelOverride);
}
function applyModelOverride(config, override) {
    if (!override?.provider && !override?.name)
        return config;
    return {
        ...config,
        model: {
            ...(config.model ?? {}),
            provider: override.provider ?? config.model?.provider,
            name: override.name ?? (override.provider ? undefined : config.model?.name),
        },
    };
}
function latestTurnId(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.turnId)
            return event.turnId;
    }
    return undefined;
}
