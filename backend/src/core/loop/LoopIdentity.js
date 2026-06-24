export function createLoopIdentity(input) {
    const createdAtMs = input.createdAtMs ?? Date.now();
    return {
        workspaceId: input.workspaceId,
        loopId: input.loopId ?? createLoopId(createdAtMs),
        goalId: input.goalId ?? createGoalId(createdAtMs),
        rootThreadId: input.rootThreadId,
        createdByCommandId: input.createdByCommandId,
        source: input.source ?? 'daemon',
        createdAtMs,
    };
}
export function createLoopId(nowMs = Date.now()) {
    return createScopedId('loop', nowMs);
}
export function createGoalId(nowMs = Date.now()) {
    return createScopedId('goal', nowMs);
}
export function createPlanId(nowMs = Date.now()) {
    return createScopedId('plan', nowMs);
}
export function createTaskId(nowMs = Date.now()) {
    return createScopedId('task', nowMs);
}
export function createAttemptId(nowMs = Date.now()) {
    return createScopedId('attempt', nowMs);
}
export function createGateId(nowMs = Date.now()) {
    return createScopedId('gate', nowMs);
}
export function createLoopCheckpointId(nowMs = Date.now()) {
    return createScopedId('loop_checkpoint', nowMs);
}
function createScopedId(prefix, nowMs) {
    const time = Math.max(0, Math.trunc(nowMs)).toString(36);
    const entropy = Math.random().toString(36).slice(2, 12);
    return `${prefix}_${time}_${entropy}`;
}
