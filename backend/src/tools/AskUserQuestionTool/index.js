import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalQuestionStore } from '../../services/questions/index.js';
import { optionalPositiveInteger, optionalString, requiredString } from '../shared/index.js';
export const AskUserQuestionTool = {
    name: 'ask_user_question',
    description: 'Queue a blocking or non-blocking clarification question for Web UI, Gateway, or CLI user response.',
    safety: 'workspace_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            mode: { type: 'string', enum: ['blocking', 'non_blocking'] },
            autoResolutionMs: { type: 'integer', minimum: 1 },
            defaultAnswer: { type: 'string' },
            goalId: { type: 'string' },
            taskId: { type: 'string' },
        },
        required: ['question'],
    },
    async execute(toolUse, context) {
        try {
            const question = requiredString(toolUse.input, 'question');
            const mode = parseMode(optionalString(toolUse.input, 'mode') ?? 'blocking');
            const autoResolutionMs = optionalPositiveInteger(toolUse.input, 'autoResolutionMs', 0);
            const record = await new LocalQuestionStore(context.cwd).createQuestion({
                question,
                mode,
                autoResolutionMs: autoResolutionMs || undefined,
                defaultAnswer: optionalString(toolUse.input, 'defaultAnswer'),
                goalId: optionalString(toolUse.input, 'goalId') ?? metadataString(context, 'goalId'),
                taskId: optionalString(toolUse.input, 'taskId') ?? metadataString(context, 'taskId'),
                threadId: context.threadId,
                sessionId: context.sessionId,
            });
            return createTextResult(toolUse.id, JSON.stringify(record, null, 2), true, {
                questionId: record.questionId,
                status: record.status,
                mode,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'ask_user_question' });
        }
    },
};
function metadataString(context, key) {
    const value = context.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function parseMode(value) {
    if (value === 'blocking' || value === 'non_blocking')
        return value;
    throw new Error('mode must be blocking or non_blocking');
}
