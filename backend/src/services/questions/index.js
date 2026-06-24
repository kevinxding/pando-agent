import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const QUESTIONS_FILE = 'questions.jsonl';
export class LocalQuestionStore {
    workspaceRoot;
    root;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.root = join(workspaceRoot, '.pandoshare', 'questions');
    }
    async createQuestion(input) {
        const now = Date.now();
        const question = {
            questionId: sanitizeQuestionId(input.questionId ?? `question_${now}_${shortId()}`),
            question: requiredText(input.question, 'question'),
            mode: input.mode ?? 'blocking',
            status: input.mode === 'non_blocking' ? 'queued' : 'waiting',
            createdAtMs: now,
            updatedAtMs: now,
            autoResolutionMs: positiveInteger(input.autoResolutionMs),
            defaultAnswer: optionalText(input.defaultAnswer),
            goalId: optionalId(input.goalId),
            taskId: optionalId(input.taskId),
            threadId: optionalId(input.threadId),
            sessionId: requiredText(input.sessionId, 'sessionId'),
        };
        await this.ensure();
        await appendFile(this.questionsPath(), `${JSON.stringify(question)}\n`, 'utf8');
        return question;
    }
    async listQuestions(options = {}) {
        await this.applyAutoResolution();
        const questions = await this.readAll();
        const filtered = questions
            .filter(question => !options.status || question.status === options.status)
            .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        return filtered.slice(0, options.limit ?? 50);
    }
    async readQuestion(questionId) {
        await this.applyAutoResolution();
        const question = (await this.readAll()).find(item => item.questionId === sanitizeQuestionId(questionId));
        if (!question)
            throw new Error(`Question not found: ${questionId}`);
        return question;
    }
    async answerQuestion(questionId, answer, answeredBy = 'user') {
        const safeQuestionId = sanitizeQuestionId(questionId);
        const questions = await this.readAll();
        const index = questions.findIndex(item => item.questionId === safeQuestionId);
        if (index === -1)
            throw new Error(`Question not found: ${questionId}`);
        const current = questions[index];
        if (current.status === 'answered')
            return current;
        const now = Date.now();
        const next = {
            ...current,
            status: 'answered',
            answer: requiredText(answer, 'answer'),
            answeredBy: requiredText(answeredBy, 'answeredBy'),
            answeredAtMs: now,
            updatedAtMs: now,
        };
        questions[index] = next;
        await this.writeAll(questions);
        return next;
    }
    async applyAutoResolution() {
        const questions = await this.readAll();
        let changed = false;
        const now = Date.now();
        const next = questions.map(question => {
            if (question.status === 'answered' || question.status === 'expired')
                return question;
            if (!question.autoResolutionMs || now - question.createdAtMs < question.autoResolutionMs)
                return question;
            changed = true;
            if (question.defaultAnswer) {
                return {
                    ...question,
                    status: 'answered',
                    answer: question.defaultAnswer,
                    answeredBy: 'auto_resolution',
                    answeredAtMs: now,
                    updatedAtMs: now,
                };
            }
            return {
                ...question,
                status: 'expired',
                updatedAtMs: now,
            };
        });
        if (changed)
            await this.writeAll(next);
    }
    async readAll() {
        await this.ensure();
        let text = '';
        try {
            text = await readFile(this.questionsPath(), 'utf8');
        }
        catch {
            return [];
        }
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
            try {
                return [JSON.parse(line)];
            }
            catch {
                return [];
            }
        });
    }
    async writeAll(questions) {
        await this.ensure();
        await writeFile(this.questionsPath(), questions.map(question => JSON.stringify(question)).join('\n') + (questions.length ? '\n' : ''), 'utf8');
    }
    async ensure() {
        await mkdir(this.root, { recursive: true });
    }
    questionsPath() {
        return join(this.root, QUESTIONS_FILE);
    }
}
function requiredText(value, name) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}
function optionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function positiveInteger(value) {
    if (value === undefined)
        return undefined;
    if (!Number.isInteger(value) || value <= 0)
        throw new Error('autoResolutionMs must be a positive integer');
    return value;
}
function optionalId(value) {
    if (!value)
        return undefined;
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(`Invalid id: ${value}`);
    return value;
}
function sanitizeQuestionId(questionId) {
    if (!/^[A-Za-z0-9_-]+$/.test(questionId))
        throw new Error(`Invalid questionId: ${questionId}`);
    return questionId;
}
function shortId() {
    return Math.random().toString(36).slice(2, 8);
}
