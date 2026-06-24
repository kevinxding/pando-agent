export function createCommandEnvelope(input) {
    const envelope = {
        schemaVersion: 1,
        commandId: input.commandId ?? createProtocolId('cmd'),
        commandType: input.commandType,
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        runId: input.runId,
        goalId: input.goalId,
        loopId: input.loopId,
        source: input.source,
        createdAtMs: input.createdAtMs ?? Date.now(),
        payload: input.payload,
    };
    validateCommandEnvelope(envelope);
    return envelope;
}
export function isCommandEnvelope(value) {
    try {
        validateCommandEnvelope(value);
        return true;
    }
    catch {
        return false;
    }
}
export function validateCommandEnvelope(value) {
    assertRecord(value, 'CommandEnvelope');
    if (value.schemaVersion !== 1)
        throw new Error('CommandEnvelope.schemaVersion must be 1');
    assertNonEmptyString(value.commandId, 'CommandEnvelope.commandId');
    assertNonEmptyString(value.commandType, 'CommandEnvelope.commandType');
    assertNonEmptyString(value.workspaceId, 'CommandEnvelope.workspaceId');
    assertOptionalAsciiId(value.threadId, 'CommandEnvelope.threadId');
    assertOptionalAsciiId(value.runId, 'CommandEnvelope.runId');
    assertOptionalAsciiId(value.goalId, 'CommandEnvelope.goalId');
    assertOptionalAsciiId(value.loopId, 'CommandEnvelope.loopId');
    if (!isCommandSource(value.source))
        throw new Error('CommandEnvelope.source is invalid');
    assertFiniteTimestamp(value.createdAtMs, 'CommandEnvelope.createdAtMs');
    if (!('payload' in value))
        throw new Error('CommandEnvelope.payload is required');
}
export function createProtocolId(prefix, now = Date.now()) {
    return `${prefix}_${now}_${Math.random().toString(36).slice(2, 10)}`;
}
function isCommandSource(value) {
    return value === 'cli' || value === 'web' || value === 'gateway' || value === 'daemon' || value === 'test';
}
function assertRecord(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${name} must be an object`);
}
function assertNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error(`${name} must be a non-empty string`);
}
function assertOptionalAsciiId(value, name) {
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error(`${name} must be an ASCII id`);
    }
}
function assertFiniteTimestamp(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a finite timestamp`);
    }
}
