import { Script, createContext } from 'node:vm';
import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { optionalPositiveInteger, optionalString, requiredString } from '../shared/index.js';
const sessions = new Map();
export const REPLTool = {
    name: 'repl',
    description: 'Run JavaScript in a persistent workspace-scoped REPL session with timeout and captured console output.',
    safety: 'external_write',
    platforms: ['all'],
    behavior: { reads: true, writes: true },
    concurrency: 'serial',
    inputSchema: {
        type: 'object',
        properties: {
            language: { type: 'string', enum: ['javascript'] },
            sessionName: { type: 'string' },
            code: { type: 'string' },
            timeoutMs: { type: 'integer', minimum: 1 },
        },
        required: ['code'],
    },
    async execute(toolUse, context) {
        try {
            const language = optionalString(toolUse.input, 'language') ?? 'javascript';
            if (language !== 'javascript')
                throw new Error(`Unsupported REPL language: ${language}`);
            const sessionName = sanitizeSession(optionalString(toolUse.input, 'sessionName') ?? context.sessionId);
            const session = getSession(sessionName, context.cwd);
            const code = requiredString(toolUse.input, 'code');
            const script = new Script(code, { filename: `${sessionName}.repl.js` });
            const result = script.runInContext(session.context, {
                timeout: optionalPositiveInteger(toolUse.input, 'timeoutMs', 5000),
            });
            const stdout = session.stdout.splice(0).join('\n');
            return createTextResult(toolUse.id, JSON.stringify({ result: printable(result), stdout, sessionName }, null, 2), true, {
                sessionName,
                language,
            });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'repl' });
        }
    },
};
function getSession(sessionName, cwd) {
    const existing = sessions.get(sessionName);
    if (existing)
        return existing;
    const stdout = [];
    const context = createContext({
        cwd,
        console: {
            log: (...args) => stdout.push(args.map(printable).join(' ')),
            error: (...args) => stdout.push(args.map(printable).join(' ')),
        },
        Math,
        JSON,
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Set,
        Map,
    });
    const session = { context, stdout };
    sessions.set(sessionName, session);
    return session;
}
function printable(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined)
        return 'undefined';
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function sanitizeSession(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(`Invalid sessionName: ${value}`);
    return value;
}
