export class TaskQueue {
    tasks = [];
    enqueue(task) {
        this.tasks.push({ ...task, status: 'queued' });
    }
    next() {
        const index = this.tasks.findIndex(task => task.status === 'queued');
        if (index === -1)
            return undefined;
        const task = { ...this.tasks[index], status: 'running' };
        this.tasks[index] = task;
        return task;
    }
    update(task) {
        const index = this.tasks.findIndex(item => item.taskId === task.taskId);
        if (index === -1)
            this.tasks.push(task);
        else
            this.tasks[index] = task;
    }
    list() {
        return [...this.tasks];
    }
}
