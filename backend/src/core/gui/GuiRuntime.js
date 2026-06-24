import { DurableRuntime } from '../durable/index.js';
import { JsonlStore, RuntimePaths } from '../store/index.js';
import { DingxuGuiAdapter, MockGuiAdapter } from './DingxuGuiAdapter.js';
import { GuiActionVerifier } from './GuiActionVerifier.js';
import { GuiApprovalBridge } from './GuiApprovalBridge.js';
import { GUI_EVENT_TYPES } from './GuiEventTypes.js';
import { createGuiActionIdentity } from './GuiIdentity.js';
import { GuiLeaseManager } from './GuiLease.js';
import { GuiObservationStore } from './GuiObservationStore.js';
import { classifyGuiAction, requiresGuiApproval, toGuiSideEffect } from './GuiPolicy.js';
import { GuiStuckDetector } from './GuiStuckDetector.js';
export class GuiRuntime {
    workspaceId;
    durable;
    adapter;
    store;
    verifier;
    approval;
    leases;
    stuck;
    defaultApprovalPolicy;
    constructor(input) {
        this.workspaceId = input.workspaceId ?? 'default';
        this.durable = new DurableRuntime({ workspaceRoot: input.workspaceRoot, workspaceId: this.workspaceId });
        this.adapter = input.adapter ?? new MockGuiAdapter();
        this.verifier = new GuiActionVerifier(this.adapter);
        this.approval = new GuiApprovalBridge(this.durable);
        this.stuck = new GuiStuckDetector(this.durable);
        this.defaultApprovalPolicy = input.defaultApprovalPolicy ?? 'ask';
        const paths = new RuntimePaths({ workspaceRoot: input.workspaceRoot, workspaceId: this.workspaceId });
        this.store = new GuiObservationStore(new JsonlStore(paths.queuePath('gui-actions')), new JsonlStore(paths.queuePath('gui-observations')));
        this.leases = new GuiLeaseManager(new JsonlStore(paths.queuePath('gui-leases')));
    }
    static fromDingxu(input) {
        return new GuiRuntime({
            ...input,
            adapter: new DingxuGuiAdapter(input.backend),
        });
    }
    async observe(context = {}) {
        const start = await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.observationStarted,
            workspaceId: this.workspaceId,
            runId: context.runId,
            loopId: context.loopId,
            goalId: context.goalId,
            taskId: context.taskId,
            payload: {
                guiActionId: context.guiActionId,
                attemptId: context.attemptId,
            },
        });
        const observation = await this.adapter.observe(context);
        const completed = await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.observationCompleted,
            workspaceId: this.workspaceId,
            runId: context.runId,
            loopId: context.loopId,
            goalId: context.goalId,
            taskId: context.taskId,
            payload: {
                guiActionId: context.guiActionId,
                attemptId: context.attemptId,
                observationId: observation.observationId,
                screenshotRef: observation.screenshotRef,
                accessibilityTreeRef: observation.accessibilityTreeRef,
                focusedApp: observation.focusedApp,
                focusedElement: observation.focusedElement,
                source: observation.source,
                confidence: observation.confidence,
                summary: observation.summary,
                startedEventId: start.eventId,
            },
        });
        await this.store.recordObservation(observation);
        void completed;
        return observation;
    }
    async requestAction(action, context = {}) {
        const identity = createGuiActionIdentity({
            workspaceId: this.workspaceId,
            guiActionId: context.guiActionId,
            runId: context.runId,
            loopId: context.loopId,
            goalId: context.goalId,
            taskId: context.taskId,
            attemptId: context.attemptId,
            source: context.source ?? 'agent',
        });
        const normalizedAction = {
            ...action,
            approvalPolicy: action.approvalPolicy ?? this.defaultApprovalPolicy,
        };
        const risk = classifyGuiAction(normalizedAction);
        const sideEffectHint = toGuiSideEffect(normalizedAction, identity.guiActionId);
        const requested = await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.actionRequested,
            workspaceId: this.workspaceId,
            runId: identity.runId,
            loopId: identity.loopId,
            goalId: identity.goalId,
            taskId: identity.taskId,
            payload: {
                ...identityPayload(identity),
                action: summarizeAction(normalizedAction),
                risk,
                sideEffect: sideEffectHint,
            },
        });
        const approval = await this.approval.apply({
            identity,
            action: normalizedAction,
            risk,
            policy: normalizedAction.approvalPolicy ?? this.defaultApprovalPolicy,
            required: requiresGuiApproval(normalizedAction, normalizedAction.approvalPolicy ?? this.defaultApprovalPolicy),
        });
        const state = approval.status === 'waiting'
            ? 'waiting_approval'
            : approval.status === 'rejected'
                ? 'rejected'
                : approval.status === 'approved'
                    ? 'approved'
                    : 'requested';
        const record = {
            actionId: identity.guiActionId,
            eventId: requested.eventId,
            identity,
            state,
            action: normalizedAction,
            approval,
            sideEffect: sideEffectRecord(sideEffectHint),
            eventIds: [requested.eventId],
            createdAtMs: identity.createdAtMs,
            completedAtMs: state === 'rejected' ? Date.now() : undefined,
        };
        await this.record(record);
        return record;
    }
    async approveGuiAction(guiActionId, reason) {
        const record = await this.requireAction(guiActionId);
        const risk = classifyGuiAction(record.action);
        const approval = await this.approval.approveGuiAction(record.identity, record.action, risk, reason);
        const approved = {
            ...record,
            state: 'approved',
            approval,
            eventIds: [...record.eventIds],
        };
        await this.record(approved);
        return approved;
    }
    async rejectGuiAction(guiActionId, reason) {
        const record = await this.requireAction(guiActionId);
        const risk = classifyGuiAction(record.action);
        const approval = await this.approval.rejectGuiAction(record.identity, record.action, risk, reason);
        const rejected = {
            ...record,
            state: 'rejected',
            approval,
            completedAtMs: Date.now(),
        };
        await this.record(rejected);
        return rejected;
    }
    async executeApprovedAction(guiActionId) {
        const record = await this.requireAction(guiActionId);
        if (record.state === 'rejected')
            return record;
        if (record.approval?.status === 'waiting')
            throw new Error(`GUI action is waiting for approval: ${guiActionId}`);
        if (record.approval?.status === 'rejected')
            return record;
        return this.executeRecord(record);
    }
    async act(action, context = {}) {
        const requested = await this.requestAction({
            ...action,
            approvalPolicy: action.approvalPolicy ?? 'trusted',
        }, context);
        if (requested.state === 'waiting_approval' || requested.state === 'rejected')
            return requested;
        return this.executeApprovedAction(requested.identity.guiActionId);
    }
    async verify(input, context = {}) {
        if (typeof input !== 'string')
            return this.verifier.verify(input, context);
        const record = await this.requireAction(input);
        return this.verifier.verify(record.action, { ...context, guiActionId: input });
    }
    async recoverGuiAction(guiActionId) {
        const record = await this.requireAction(guiActionId);
        const risk = classifyGuiAction(record.action);
        const decision = record.state === 'completed' || record.state === 'verified'
            ? { decision: 'already_completed', reason: 'GUI action already completed.', guiActionId, state: record.state }
            : record.state === 'stuck' || risk.level === 'write' || risk.level === 'dangerous_write'
                ? { decision: 'requires_human', reason: `GUI ${risk.level} action is not auto-recoverable.`, guiActionId, state: record.state }
                : { decision: 'recoverable_readonly', reason: 'Read-only GUI action can be safely retried.', guiActionId, state: record.state };
        await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.actionRecoveryDecided,
            workspaceId: this.workspaceId,
            runId: record.identity.runId,
            loopId: record.identity.loopId,
            goalId: record.identity.goalId,
            taskId: record.identity.taskId,
            payload: decision,
        });
        return decision;
    }
    readAction(guiActionId) {
        return this.store.readByActionId(guiActionId);
    }
    listRecentActions(limit = 20) {
        return this.store.listRecentActions(limit);
    }
    record(record) {
        return this.store.record(record);
    }
    async executeRecord(record) {
        const risk = classifyGuiAction(record.action);
        const isWrite = risk.level !== 'read_only';
        let lease = record.lease;
        const eventIds = [...record.eventIds];
        try {
            if (isWrite)
                lease = await this.leases.acquire({
                    workspaceId: this.workspaceId,
                    guiActionId: record.identity.guiActionId,
                    holder: record.identity.source,
                    ttlMs: record.action.timeoutMs,
                });
            const started = await this.durable.appendEvent({
                eventType: GUI_EVENT_TYPES.actionStarted,
                workspaceId: this.workspaceId,
                runId: record.identity.runId,
                loopId: record.identity.loopId,
                goalId: record.identity.goalId,
                taskId: record.identity.taskId,
                payload: {
                    ...identityPayload(record.identity),
                    action: summarizeAction(record.action),
                    risk,
                    leaseId: lease?.leaseId,
                },
            });
            eventIds.push(started.eventId);
            const beforeObservation = await this.observe(record.identity);
            const timed = await this.stuck.runWithTimeout({
                identity: record.identity,
                timeoutMs: record.action.timeoutMs,
                action: record.action.action,
                run: () => this.adapter.act(record.action, record.identity),
            });
            if (timed.status === 'stuck') {
                eventIds.push(await this.stuck.writeStuck({ identity: record.identity, action: record.action.action, message: timed.message }));
                eventIds.push(await this.releaseInput(record, timed.message));
                const stuckRecord = await this.finishRecord({ ...record, lease, beforeObservation, eventIds }, 'stuck', undefined, {
                    ok: false,
                    status: 'failed',
                    message: timed.message,
                    beforeObservationId: beforeObservation.observationId,
                    visualChange: 'unknown',
                    reasonCode: 'timeout',
                }, 'unsafe_to_replay');
                await this.leases.release(lease);
                return stuckRecord;
            }
            const result = normalizeAdapterResult(timed.value);
            const afterObservation = await this.observe(record.identity);
            const verification = await this.verifier.verify(record.action, {
                ...record.identity,
                guiActionId: record.identity.guiActionId,
            });
            const verified = await this.durable.appendEvent({
                eventType: GUI_EVENT_TYPES.actionVerified,
                workspaceId: this.workspaceId,
                runId: record.identity.runId,
                loopId: record.identity.loopId,
                goalId: record.identity.goalId,
                taskId: record.identity.taskId,
                payload: {
                    ...identityPayload(record.identity),
                    ok: verification.ok,
                    status: verification.status,
                    message: verification.message,
                    beforeObservationId: beforeObservation.observationId,
                    afterObservationId: afterObservation.observationId,
                    screenshotRef: verification.screenshotRef,
                    visualChange: verification.visualChange,
                    reasonCode: verification.reasonCode,
                },
            });
            eventIds.push(verified.eventId);
            const state = result.ok && verification.status === 'passed' ? 'completed' : 'failed';
            const finished = await this.finishRecord({ ...record, lease, beforeObservation, afterObservation, eventIds }, state, result, verification, state === 'completed' ? 'safe_to_replay' : 'partial_replay');
            await this.leases.release(lease);
            return finished;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failed = await this.durable.appendEvent({
                eventType: GUI_EVENT_TYPES.actionFailed,
                workspaceId: this.workspaceId,
                runId: record.identity.runId,
                loopId: record.identity.loopId,
                goalId: record.identity.goalId,
                taskId: record.identity.taskId,
                payload: { ...identityPayload(record.identity), message, action: record.action.action, risk },
            });
            eventIds.push(failed.eventId);
            if (isWrite)
                eventIds.push(await this.releaseInput(record, message));
            await this.leases.release(lease);
            const failedRecord = await this.finishRecord({ ...record, lease, eventIds }, 'failed', {
                ok: false,
                message,
                method: 'none',
                failureClass: 'gui_runtime_failed',
            }, {
                ok: false,
                status: 'failed',
                message,
                visualChange: 'unknown',
                reasonCode: 'gui_runtime_failed',
            }, 'partial_replay');
            return failedRecord;
        }
    }
    async finishRecord(record, state, result, verification, checkpointStatus) {
        const checkpoint = await this.durable.createCheckpoint({
            workspaceId: this.workspaceId,
            runId: record.identity.runId,
            loopId: record.identity.loopId,
            goalId: record.identity.goalId,
            status: checkpointStatus,
            summary: `GUI action ${state}: ${record.action.action}`,
            effectHints: [toGuiSideEffect(record.action, record.identity.guiActionId)],
            payload: {
                guiActionId: record.identity.guiActionId,
                state,
                action: summarizeAction(record.action),
                verification,
                screenshotRef: verification.screenshotRef ?? result?.screenshotRef ?? result?.screenshotPath,
            },
        });
        const eventType = state === 'completed' ? GUI_EVENT_TYPES.actionCompleted : state === 'stuck' ? GUI_EVENT_TYPES.actionStuck : GUI_EVENT_TYPES.actionFailed;
        const event = await this.durable.appendEvent({
            eventType,
            workspaceId: this.workspaceId,
            runId: record.identity.runId,
            loopId: record.identity.loopId,
            goalId: record.identity.goalId,
            taskId: record.identity.taskId,
            payload: {
                ...identityPayload(record.identity),
                state,
                checkpointId: checkpoint.checkpointId,
                action: summarizeAction(record.action),
                result: result ? summarizeResult(result) : undefined,
                verification,
            },
        });
        const finished = {
            ...record,
            actionId: record.identity.guiActionId,
            eventId: event.eventId,
            state,
            result,
            verification,
            checkpointId: checkpoint.checkpointId,
            sideEffect: checkpoint.pendingExternalEffects[0] ?? record.sideEffect,
            eventIds: [...record.eventIds, event.eventId],
            completedAtMs: Date.now(),
            screenshotRef: verification.screenshotRef ?? result?.screenshotRef ?? result?.screenshotPath,
        };
        await this.record(finished);
        return finished;
    }
    async releaseInput(record, reason) {
        await this.adapter.act({ action: 'release_all', approvalPolicy: 'trusted', verify: false }, record.identity).catch(() => undefined);
        const event = await this.durable.appendEvent({
            eventType: GUI_EVENT_TYPES.inputReleased,
            workspaceId: this.workspaceId,
            runId: record.identity.runId,
            loopId: record.identity.loopId,
            goalId: record.identity.goalId,
            taskId: record.identity.taskId,
            payload: {
                ...identityPayload(record.identity),
                reason,
            },
        });
        return event.eventId;
    }
    async requireAction(guiActionId) {
        const record = await this.readAction(guiActionId);
        if (!record)
            throw new Error(`Missing GUI action: ${guiActionId}`);
        return record;
    }
}
function identityPayload(identity) {
    return {
        guiActionId: identity.guiActionId,
        runId: identity.runId,
        loopId: identity.loopId,
        goalId: identity.goalId,
        taskId: identity.taskId,
        attemptId: identity.attemptId,
        source: identity.source,
    };
}
function summarizeAction(action) {
    return {
        action: action.action,
        target: action.target,
        textLength: typeof action.text === 'string' ? action.text.length : undefined,
        keys: action.keys,
        x: action.x,
        y: action.y,
        points: action.points?.length,
        region: action.region,
        timeoutMs: action.timeoutMs,
        verify: action.verify,
        riskHint: action.riskHint,
        approvalPolicy: action.approvalPolicy,
        expectedChange: action.expectedChange,
        idempotencyKey: action.idempotencyKey,
    };
}
function summarizeResult(result) {
    return {
        ok: result.ok,
        method: result.method,
        message: result.message,
        screenshotRef: result.screenshotRef ?? result.screenshotPath,
        fallbackUsed: result.fallbackUsed,
        failureClass: result.failureClass,
        audit: summarizeAudit(result.audit),
    };
}
function summarizeAudit(audit) {
    if (!audit)
        return undefined;
    const out = {};
    for (const key of ['tool', 'sequenceId', 'actionId', 'observationId', 'beforeObservationId', 'afterObservationId', 'sourceImagePath', 'markedImagePath', 'afterImagePath', 'annotatedImagePath', 'diffImagePath', 'failureEvidencePath', 'failureClass']) {
        if (audit[key] !== undefined)
            out[key] = audit[key];
    }
    return out;
}
function normalizeAdapterResult(result) {
    return {
        ...result,
        screenshotRef: result.screenshotRef ?? result.screenshotPath,
    };
}
function sideEffectRecord(hint) {
    return {
        effectId: hint.effectId ?? `effect_${Date.now()}`,
        effectType: hint.effectType ?? 'gui_write',
        summary: hint.summary ?? hint.action ?? 'gui action',
        confirmed: hint.confirmed ?? false,
    };
}
