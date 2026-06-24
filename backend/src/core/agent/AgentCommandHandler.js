export class AgentCommandHandler {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    async handle(command, context) {
        switch (command.commandType) {
            case 'agent.run':
                return this.handleRun(command, context);
            case 'agent.resume':
                return this.handleResume(command, context);
            case 'agent.interrupt':
                return this.handleInterrupt(command, context, 'interrupted_by_user');
            case 'agent.stop':
                return this.handleInterrupt(command, context, 'stop_requested');
            case 'agent.status':
                return this.handleStatus();
            default:
                throw new Error(`Unsupported AgentKernel command: ${command.commandType}`);
        }
    }
    handleRun(command, context) {
        const payload = command.payload;
        const prompt = requiredPrompt(payload.prompt, 'agent.run command requires payload.prompt');
        return this.runtime.adapter.run(prompt, context);
    }
    handleResume(command, context) {
        const payload = command.payload;
        const threadId = command.threadId ?? payload.threadId;
        if (typeof threadId !== 'string' || !threadId.trim()) {
            throw new Error('agent.resume command requires threadId or payload.threadId');
        }
        // TODO: replace this legacy resume path once QueryEngine exposes a first-class resume API.
        // For now the adapter initializes QueryEngine with the normalized command threadId.
        const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
            ? payload.prompt.trim()
            : `Resume thread ${threadId}.`;
        return this.runtime.adapter.run(prompt, context);
    }
    async handleInterrupt(command, context, defaultReason) {
        const payload = command.payload;
        const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : defaultReason;
        await this.runtime.interruptRun(context.identity.runId, reason);
        this.runtime.abort(reason);
        return syntheticOutput(`run interrupted: ${context.identity.runId}`);
    }
    handleStatus() {
        const active = this.runtime.readActiveRuns();
        const recent = this.runtime.readRecentRuns(5);
        const activeText = active.length
            ? active.map(run => `${run.runId}:${run.status}`).join(', ')
            : 'none';
        const recentText = recent.length
            ? recent.map(run => `${run.runId}:${run.status}`).join(', ')
            : 'none';
        return syntheticOutput(`active runs: ${activeText}\nrecent runs: ${recentText}`);
    }
}
function requiredPrompt(value, message) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(message);
    return value.trim();
}
function syntheticOutput(finalText) {
    return {
        finalText,
        toolResults: [],
    };
}
