export function createGuiActionIdentity(input) {
    const createdAtMs = input.createdAtMs ?? Date.now();
    return {
        workspaceId: input.workspaceId,
        guiActionId: input.guiActionId ?? createGuiActionId(createdAtMs),
        runId: input.runId,
        loopId: input.loopId,
        goalId: input.goalId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        source: input.source ?? 'agent',
        createdAtMs,
    };
}
export function createGuiActionId(nowMs = Date.now()) {
    return createScopedId('gui_action', nowMs);
}
export function createGuiObservationId(nowMs = Date.now()) {
    return createScopedId('gui_obs', nowMs);
}
export function createGuiLeaseId(nowMs = Date.now()) {
    return createScopedId('gui_lease', nowMs);
}
function createScopedId(prefix, nowMs) {
    const time = Math.max(0, Math.trunc(nowMs)).toString(36);
    const entropy = Math.random().toString(36).slice(2, 12);
    return `${prefix}_${time}_${entropy}`;
}
