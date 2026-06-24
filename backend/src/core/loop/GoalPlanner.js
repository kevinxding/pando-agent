import { createGoalId, createPlanId, createTaskId } from './LoopIdentity.js';
export class GoalPlanner {
    createGoal(input) {
        const objective = input.objective.trim();
        if (!objective)
            throw new Error('Goal objective must not be empty');
        const createdAtMs = Date.now();
        return {
            goalId: input.goalId ?? createGoalId(createdAtMs),
            objective,
            successCriteria: input.successCriteria ?? [],
            constraints: input.constraints ?? [],
            status: 'created',
            createdAtMs,
        };
    }
    createPlan(goal) {
        const createdAtMs = Date.now();
        const task = {
            taskId: createTaskId(createdAtMs),
            goalId: goal.goalId,
            title: firstLine(goal.objective),
            status: 'queued',
            executionMode: 'code',
            verifier: {
                type: 'custom',
                name: 'manual_review',
            },
            requiresApproval: false,
        };
        return {
            planId: createPlanId(createdAtMs),
            goalId: goal.goalId,
            tasks: [task],
            createdAtMs,
        };
    }
}
function firstLine(value) {
    return value.split(/\r?\n/)[0]?.trim().slice(0, 100) || 'Loop task';
}
