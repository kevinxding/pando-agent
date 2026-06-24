import { readFile, stat } from 'node:fs/promises';
import { LOOP_EVENT_TYPES } from './LoopEventTypes.js';
export class LoopVerifier {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async verify(spec, context) {
        const durable = context?.durable ?? this.durable;
        if (context && durable) {
            await durable.appendEvent({
                eventType: LOOP_EVENT_TYPES.verificationStarted,
                workspaceId: context.workspaceId,
                loopId: context.loopId,
                goalId: context.goalId,
                runId: context.runId,
                taskId: context.taskId,
                payload: verificationPayload(spec, context),
            });
        }
        const result = await this.verifyInner(spec);
        if (context && durable) {
            await durable.appendEvent({
                eventType: LOOP_EVENT_TYPES.verificationCompleted,
                workspaceId: context.workspaceId,
                loopId: context.loopId,
                goalId: context.goalId,
                runId: context.runId,
                taskId: context.taskId,
                payload: {
                    ...verificationPayload(spec, context),
                    ok: result.ok,
                    message: result.message,
                    reason: result.reason,
                    summary: result.message,
                    metadata: result.metadata,
                },
            });
        }
        return result;
    }
    async verifyInner(spec) {
        switch (spec.type) {
            case 'command':
                return {
                    ok: Boolean(spec.command.trim()),
                    verifierType: 'command',
                    message: 'Command verifier is registered but not executed by core LoopVerifier V2.',
                    metadata: {
                        command: spec.command,
                        cwd: spec.cwd,
                        timeoutMs: spec.timeoutMs,
                        command_placeholder: true,
                    },
                };
            case 'file':
                return this.verifyFile(spec);
            case 'custom':
                return {
                    ok: true,
                    verifierType: 'custom',
                    message: `Custom verifier accepted as placeholder: ${spec.name}`,
                    metadata: {
                        custom_unverified: true,
                    },
                };
        }
    }
    async verifyFile(spec) {
        const exists = await pathExists(spec.path);
        const shouldExist = spec.exists ?? true;
        if (exists !== shouldExist) {
            return {
                ok: false,
                verifierType: 'file',
                message: shouldExist ? `Expected file to exist: ${spec.path}` : `Expected file to be absent: ${spec.path}`,
                reason: 'file_existence_mismatch',
            };
        }
        if (!exists || spec.contains === undefined) {
            return {
                ok: true,
                verifierType: 'file',
                message: `File verifier passed: ${spec.path}`,
            };
        }
        const content = await readFile(spec.path, 'utf8');
        const ok = content.includes(spec.contains);
        return {
            ok,
            verifierType: 'file',
            message: ok ? `File contains expected text: ${spec.path}` : `File missing expected text: ${spec.path}`,
            reason: ok ? undefined : 'file_content_mismatch',
        };
    }
}
function verificationPayload(spec, context) {
    return {
        verifierType: spec.type,
        taskId: context.taskId,
        attemptId: context.attemptId,
        runId: context.runId,
        summary: spec.type === 'command'
            ? { command: spec.command, cwd: spec.cwd, timeoutMs: spec.timeoutMs }
            : spec.type === 'file'
                ? { path: spec.path, exists: spec.exists, contains: spec.contains !== undefined }
                : { name: spec.name, custom_unverified: true },
    };
}
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
