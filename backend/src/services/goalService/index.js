export class GoalService {
    store;
    constructor(store) {
        this.store = store;
    }
    createGoal(input) {
        return this.store.createGoal({
            ...input,
            objective: requireNonEmpty(input.objective, 'Goal objective must not be empty'),
            requirements: input.requirements?.map(item => item.trim()).filter(Boolean),
        });
    }
    listGoals(input = {}) {
        return this.store.listGoals(input);
    }
    activeGoal() {
        return this.store.activeGoal();
    }
    readGoal(goalId) {
        return this.store.readExport(goalId);
    }
    readSummary(goalId) {
        return this.store.readSummary(goalId);
    }
    exportGoal(goalId, format = 'md') {
        return this.store.exportGoal(goalId, format);
    }
    resumeGoal(goalId, reason = 'Goal resumed.') {
        return this.store.updateStatus(goalId, 'active', reason);
    }
    pauseGoal(goalId, reason = 'Goal paused.') {
        return this.store.updateStatus(goalId, 'paused', reason);
    }
    async updateGoal(goalId, input) {
        if (input.status === 'completed')
            return this.completeGoal(goalId);
        if (input.status === 'blocked')
            return this.blockGoal(goalId, input.reason, input.source ?? 'tool');
        if (input.source === 'tool') {
            throw new Error('Model tools can only request conservative terminal goal updates: completed or blocked.');
        }
        return this.store.updateStatus(goalId, input.status, input.reason);
    }
    completeGoal(goalId) {
        return this.store.completeGoal(goalId);
    }
    async blockGoal(goalId, reason, source = 'user') {
        const message = requireNonEmpty(reason ?? '', 'Blocking a goal requires a concrete reason.');
        if (source === 'tool' || source === 'runtime') {
            const data = await this.store.readExport(goalId);
            const repeated = data.progress
                .slice(-5)
                .filter(progress => progress.message.includes(message))
                .length;
            if (repeated < 2) {
                await this.store.appendProgress(goalId, `Block attempt recorded but not accepted yet: ${message}`);
                throw new Error('Goal cannot be blocked yet: the same blocker has not repeated across multiple attempts.');
            }
        }
        return this.store.updateStatus(goalId, 'blocked', message);
    }
}
function requireNonEmpty(value, message) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error(message);
    return trimmed;
}
