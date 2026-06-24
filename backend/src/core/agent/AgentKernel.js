import { DurableRuntime, } from '../durable/index.js';
import { createCommandEnvelope, createProtocolId, } from '../protocol/index.js';
import { AgentCommandHandler } from './AgentCommandHandler.js';
import { AgentKernelAdapter } from './AgentKernelAdapter.js';
import { AgentKernelEventBridge } from './AgentKernelEventBridge.js';
import { createRunIdentity } from './RunIdentity.js';
import { RunStateMachine } from './RunStateMachine.js';
export class AgentKernel {
    options;
    workspaceId;
    durable;
    adapter;
    commandHandler;
    stateMachine;
    eventBridge = new AgentKernelEventBridge();
    envelopeEvents = [];
    constructor(options) {
        this.options = options;
        this.workspaceId = options.workspaceId ?? 'default';
        this.durable = options.durable ?? new DurableRuntime({ workspaceRoot: options.cwd, workspaceId: this.workspaceId });
        this.adapter = new AgentKernelAdapter(options);
        this.stateMachine = new RunStateMachine(event => this.appendCoreEvent(event), async (state) => {
            await this.durable.appendRunLedger(state);
        });
        this.commandHandler = new AgentCommandHandler({
            adapter: this.adapter,
            abort: reason => this.abort(reason),
            interruptRun: (runId, reason) => this.stateMachine.interruptRun(runId, reason),
            readActiveRuns: () => this.stateMachine.readActiveRuns(),
            readRecentRuns: limit => this.stateMachine.readRecentRuns(limit),
        });
    }
    submit(command) {
        return this.submitRun(command);
    }
    async submitRun(command) {
        const normalizedCommand = this.normalizeCommand(command);
        const run = await this.stateMachine.startRun(normalizedCommand);
        const context = this.createRunContext(normalizedCommand, run);
        try {
            const output = await this.commandHandler.handle(normalizedCommand, context);
            await this.forwardLegacyEvents(context);
            const current = this.stateMachine.readRun(run.runId);
            if (current?.status === 'interrupted') {
                const checkpoint = await this.createRunCheckpoint('interrupted', normalizedCommand, current, {
                    output,
                    reason: 'interrupted_by_user',
                });
                return this.buildResult(normalizedCommand, current, output, checkpoint);
            }
            const completed = await this.stateMachine.completeRun(run.runId, {
                threadId: this.threadId() ?? normalizedCommand.threadId,
                finalTextPreview: preview(output.finalText),
            });
            const checkpoint = await this.createRunCheckpoint('completed', normalizedCommand, completed, { output });
            return this.buildResult(normalizedCommand, completed, output, checkpoint);
        }
        catch (error) {
            await this.forwardLegacyEvents(context);
            const current = this.stateMachine.readRun(run.runId);
            if (current?.status === 'interrupted') {
                const output = syntheticOutput(`run interrupted: ${run.runId}`);
                const checkpoint = await this.createRunCheckpoint('interrupted', normalizedCommand, current, {
                    output,
                    reason: 'interrupted_by_user',
                });
                return this.buildResult(normalizedCommand, current, output, checkpoint);
            }
            const failed = await this.stateMachine.failRun(run.runId, error, {
                threadId: this.threadId() ?? normalizedCommand.threadId,
            });
            await this.createRunCheckpoint('failed', normalizedCommand, failed, { error });
            throw error;
        }
    }
    async submitMessage(prompt) {
        return this.run(prompt);
    }
    async run(prompt) {
        const command = createCommandEnvelope({
            commandType: 'agent.run',
            workspaceId: this.workspaceId,
            source: this.options.commandSource ?? 'cli',
            threadId: this.options.threadId,
            goalId: this.options.goalId,
            payload: {
                prompt,
            },
        });
        return (await this.submitRun(command)).output;
    }
    events() {
        return this.adapter.events();
    }
    coreEvents() {
        return this.envelopeEvents;
    }
    threadId() {
        return this.adapter.threadId();
    }
    abort(reason) {
        this.adapter.abort(reason);
    }
    recordCoreEvent(input) {
        return this.appendDurableEvent(input);
    }
    normalizeCommand(command) {
        const payloadThreadId = threadIdFromPayload(command.payload);
        return createCommandEnvelope({
            commandType: command.commandType,
            workspaceId: command.workspaceId || this.workspaceId,
            threadId: command.threadId ?? payloadThreadId ?? this.options.threadId,
            runId: command.runId ?? createProtocolId('run'),
            goalId: command.goalId ?? this.options.goalId,
            loopId: command.loopId,
            source: command.source,
            payload: command.payload,
            commandId: command.commandId,
            createdAtMs: command.createdAtMs,
        });
    }
    createRunContext(command, state) {
        return {
            identity: createRunIdentity(command),
            command,
            status: state.status,
            metadata: {
                ...(this.options.metadata ?? {}),
                runId: command.runId,
                threadId: command.threadId,
                goalId: command.goalId,
                loopId: command.loopId,
            },
        };
    }
    async forwardLegacyEvents(context) {
        const events = this.eventBridge.convert(this.adapter.events(), context);
        const persisted = await this.durable.appendEvents(events.map(eventToDurableInput));
        this.envelopeEvents.push(...persisted);
    }
    async appendCoreEvent(event) {
        await this.appendDurableEvent(eventToDurableInput(event));
    }
    async appendDurableEvent(input) {
        const persisted = await this.durable.appendEvent(input);
        this.envelopeEvents.push(persisted);
        await this.writeSnapshotForEvent(persisted);
        return persisted;
    }
    async createRunCheckpoint(status, command, state, input) {
        const threadId = this.threadId() ?? state.threadId ?? command.threadId;
        return this.durable.createCheckpoint({
            workspaceId: state.workspaceId,
            threadId,
            runId: state.runId,
            goalId: state.goalId,
            loopId: state.loopId,
            status: status === 'interrupted' ? 'unsafe_to_replay' : status === 'failed' ? 'partial_replay' : 'safe_to_replay',
            reason: status === 'interrupted' ? input.reason ?? 'interrupted_by_user' : undefined,
            commandId: command.commandId,
            summary: status === 'failed'
                ? `run failed: ${input.error ? errorMessage(input.error) : 'unknown error'}`
                : status === 'interrupted'
                    ? 'run interrupted'
                    : 'run completed',
            payload: {
                runId: state.runId,
                threadId,
                commandId: command.commandId,
                commandType: command.commandType,
                finalTextPreview: input.output ? preview(input.output.finalText) : undefined,
                errorPreview: input.error ? preview(errorMessage(input.error)) : undefined,
            },
        });
    }
    async buildResult(command, state, output, checkpoint) {
        const threadId = this.threadId() ?? state.threadId ?? command.threadId;
        return {
            runId: state.runId,
            threadId,
            finalText: output.finalText,
            output,
            coreEvents: await this.durable.readRunEvents(state.runId),
            checkpointId: checkpoint.checkpointId,
        };
    }
    async writeSnapshotForEvent(event) {
        if (!event.runId || !isCoreRunLifecycleEvent(event.eventType))
            return;
        const status = statusFromRunEvent(event);
        if (!status)
            return;
        await this.durable.writeRunSnapshot({
            workspaceId: event.workspaceId,
            runId: event.runId,
            threadId: event.threadId,
            status,
            lastEventSeq: event.seq,
            activePhase: phaseFromStatus(status),
        });
    }
}
function eventToDurableInput(event) {
    return {
        eventId: event.eventId,
        eventType: event.eventType,
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        runId: event.runId,
        goalId: event.goalId,
        loopId: event.loopId,
        taskId: event.taskId,
        toolCallId: event.toolCallId,
        parentEventId: event.parentEventId,
        createdAtMs: event.createdAtMs,
        payload: event.payload,
    };
}
function isCoreRunLifecycleEvent(eventType) {
    return eventType === 'run_created' ||
        eventType === 'run_start' ||
        eventType === 'run_running' ||
        eventType === 'run_complete' ||
        eventType === 'run_failed' ||
        eventType === 'run_interrupted';
}
function statusFromRunEvent(event) {
    if (event.eventType === 'run_created')
        return 'created';
    if (event.eventType === 'run_start')
        return 'started';
    if (event.eventType === 'run_running')
        return 'running';
    if (event.eventType === 'run_complete')
        return 'completed';
    if (event.eventType === 'run_failed')
        return 'failed';
    if (event.eventType === 'run_interrupted')
        return 'interrupted';
    return undefined;
}
function phaseFromStatus(status) {
    if (status === 'created' || status === 'started')
        return 'starting';
    if (status === 'running' || status === 'waiting_approval')
        return status === 'waiting_approval' ? 'approval' : 'model';
    if (status === 'completed')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    return 'interrupted';
}
function threadIdFromPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return undefined;
    const value = payload.threadId;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function preview(value, maxChars = 500) {
    return value.length <= maxChars ? value : value.slice(0, maxChars);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function syntheticOutput(finalText) {
    return {
        finalText,
        toolResults: [],
    };
}
