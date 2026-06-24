import { createCommandEnvelope } from '../protocol/index.js';
import { LOOP_EVENT_TYPES } from './LoopEventTypes.js';
import { createGateId } from './LoopIdentity.js';
export class HumanGate {
    durable;
    constructor(durable) {
        this.durable = durable;
    }
    async createRequest(input) {
        const createdAtMs = Date.now();
        const gateId = createGateId(createdAtMs);
        const command = createCommandEnvelope({
            commandType: 'approval.request',
            workspaceId: input.workspaceId,
            goalId: input.goalId,
            loopId: input.loopId,
            source: 'daemon',
            payload: {
                kind: 'loop',
                gateId,
                reason: input.reason,
                risk: input.risk,
                targetId: input.task.taskId,
                requestedAction: input.task.title,
            },
        });
        const request = {
            gateId,
            goalId: input.goalId,
            taskId: input.task.taskId,
            reason: input.reason,
            risk: input.risk,
            requestedAction: input.task.title,
            command,
            createdAtMs,
        };
        await this.durable?.appendEvent({
            eventType: LOOP_EVENT_TYPES.humanGateRequested,
            workspaceId: input.workspaceId,
            loopId: input.loopId,
            goalId: input.goalId,
            taskId: input.task.taskId,
            createdAtMs,
            payload: request,
        });
        return request;
    }
    async resolveRequest(input) {
        await this.durable?.appendEvent({
            eventType: LOOP_EVENT_TYPES.humanGateResolved,
            workspaceId: input.workspaceId,
            loopId: input.loopId,
            goalId: input.goalId,
            taskId: input.taskId,
            payload: {
                gateId: input.gateId,
                approved: input.approved,
                resolvedBy: input.resolvedBy,
                reason: input.reason,
                resolvedAtMs: Date.now(),
            },
        });
    }
}
