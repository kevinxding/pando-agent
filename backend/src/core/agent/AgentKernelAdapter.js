import { QueryEngine } from '../../QueryEngine.js';
// TODO: legacy adapter. QueryEngine remains the proven executor while core owns entry boundaries.
// This adapter only executes legacy turns; AgentKernel owns canonical run identity and state.
export class AgentKernelAdapter {
    options;
    engine;
    constructor(options, initialContext) {
        this.options = options;
        if (initialContext)
            this.engine = this.createEngine(initialContext);
    }
    run(prompt, context) {
        return this.getEngine(context).run(prompt);
    }
    submitMessage(prompt, context) {
        return this.getEngine(context).submitMessage(prompt);
    }
    events() {
        return this.engine?.events() ?? [];
    }
    threadId() {
        return this.engine?.threadId();
    }
    abort(reason) {
        this.engine?.abort(reason);
    }
    getEngine(context) {
        this.engine ??= this.createEngine(context);
        return this.engine;
    }
    createEngine(context) {
        return new QueryEngine({
            ...this.options,
            threadId: context?.command.threadId ?? context?.identity.threadId ?? this.options.threadId,
            goalId: context?.identity.goalId ?? this.options.goalId,
            metadata: {
                ...(this.options.metadata ?? {}),
                kernelRunId: context?.identity.runId,
                kernelCommandId: context?.identity.commandId,
            },
        });
    }
}
