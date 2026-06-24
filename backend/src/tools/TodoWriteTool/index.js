import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalGoalStore } from '../../services/goalStore/index.js';
export const TodoWriteTool = {
    name: 'todo_write',
    description: 'Persist the current multi-step agent todo list for this thread, goal, or long-running task.',
    safety: 'workspace_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            todos: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        content: { type: 'string' },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                    },
                    required: ['content', 'status'],
                },
            },
            goalId: { type: 'string' },
            taskId: { type: 'string' },
            loopId: { type: 'string' },
        },
        required: ['todos'],
    },
    isConcurrencySafe() {
        return false;
    },
    async execute(toolUse, context) {
        try {
            const todos = parseTodos(toolUse.input.todos);
            const goalId = optionalId(toolUse.input.goalId) ?? optionalId(context.metadata?.goalId);
            const taskId = optionalId(toolUse.input.taskId) ?? optionalId(context.metadata?.taskId);
            const loopId = optionalId(toolUse.input.loopId) ?? optionalId(context.metadata?.loopId);
            const todoId = goalId ?? taskId ?? loopId ?? context.threadId ?? context.sessionId;
            const dir = join(context.cwd, '.pandoshare', 'todos');
            await mkdir(dir, { recursive: true });
            const path = join(dir, `${sanitizeFileId(todoId)}.json`);
            const record = {
                id: todoId,
                goalId,
                taskId,
                loopId,
                threadId: context.threadId,
                sessionId: context.sessionId,
                updatedAtMs: Date.now(),
                todos,
            };
            await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
            let goalProgressError;
            if (goalId) {
                const inProgress = todos.find(todo => todo.status === 'in_progress');
                const completed = todos.filter(todo => todo.status === 'completed').length;
                try {
                    await new LocalGoalStore(context.cwd).appendProgress(goalId, `Todo updated: ${completed}/${todos.length} completed${inProgress ? `, current: ${inProgress.content}` : ''}.`);
                }
                catch (error) {
                    goalProgressError = error instanceof Error ? error.message : String(error);
                }
            }
            return createTextResult(toolUse.id, JSON.stringify({ ok: true, path: `.pandoshare/todos/${sanitizeFileId(todoId)}.json`, todos }, null, 2), true, {
                todoCount: todos.length,
                goalId,
                taskId,
                loopId,
                goalProgressError,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'todo_write' });
        }
    },
};
function parseTodos(value) {
    if (!Array.isArray(value))
        throw new Error('todos must be an array');
    return value.map((item, index) => {
        if (!item || typeof item !== 'object')
            throw new Error(`todo ${index} must be an object`);
        const record = item;
        if (typeof record.content !== 'string' || !record.content.trim())
            throw new Error(`todo ${index} content must be a non-empty string`);
        if (record.status !== 'pending' && record.status !== 'in_progress' && record.status !== 'completed') {
            throw new Error(`todo ${index} status must be pending, in_progress, or completed`);
        }
        return {
            id: optionalId(record.id),
            content: record.content.trim(),
            status: record.status,
        };
    });
}
function optionalId(value) {
    if (typeof value !== 'string' || !value.trim())
        return undefined;
    if (!/^[A-Za-z0-9_-]+$/.test(value.trim()))
        throw new Error(`Invalid id: ${value}`);
    return value.trim();
}
function sanitizeFileId(value) {
    return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
