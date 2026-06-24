export function createRunIdentity(command) {
    if (!command.runId)
        throw new Error('RunIdentity requires a canonical command.runId');
    return {
        workspaceId: command.workspaceId,
        threadId: command.threadId,
        runId: command.runId,
        goalId: command.goalId,
        loopId: command.loopId,
        commandId: command.commandId,
        commandType: command.commandType,
        source: command.source,
        createdAtMs: command.createdAtMs,
    };
}
