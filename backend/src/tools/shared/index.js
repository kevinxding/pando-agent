import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { platform } from 'node:os';
import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
export function requiredString(input, key) {
    const value = input[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${key} must be a non-empty string`);
    }
    return value;
}
export function requiredText(input, key) {
    const value = input[key];
    if (typeof value !== 'string') {
        throw new Error(`${key} must be a string`);
    }
    return value;
}
export function optionalString(input, key) {
    const value = input[key];
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`${key} must be a string`);
    return value;
}
export function optionalBoolean(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value !== 'boolean')
        throw new Error(`${key} must be a boolean`);
    return value;
}
export function optionalPositiveInteger(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${key} must be a positive integer`);
    }
    return value;
}
export function optionalNonNegativeInteger(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${key} must be a non-negative integer`);
    }
    return value;
}
export function resolveWorkspacePath(context, requestedPath) {
    const cwd = resolve(context.cwd);
    const absolutePath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(cwd, requestedPath);
    if (!hasDangerFullAccess(context)) {
        assertInsideWorkspace(cwd, absolutePath);
    }
    return {
        requestedPath,
        absolutePath,
        relativePath: toPortablePath(relative(cwd, absolutePath) || '.'),
    };
}
function hasDangerFullAccess(context) {
    return context.permissions?.sandboxMode === 'danger-full-access' || context.approvedExternalAccess === true;
}
export function resolveWorkspaceCwd(context, requestedCwd) {
    return resolveWorkspacePath(context, requestedCwd ?? '.');
}
export function assertCanWrite(context) {
    if (context.permissionMode === 'plan' || context.permissionMode === 'restricted') {
        throw new Error(`Tool is not allowed in ${context.permissionMode} permission mode`);
    }
}
export function assertCanRunExternal(context) {
    if (context.permissionMode === 'plan' || context.permissionMode === 'restricted') {
        throw new Error(`External command is not allowed in ${context.permissionMode} permission mode`);
    }
}
export async function readWorkspaceText(path, maxBytes) {
    const info = await stat(path.absolutePath);
    if (!info.isFile())
        throw new Error(`${path.relativePath} is not a file`);
    const text = await readFile(path.absolutePath, 'utf8');
    const truncated = text.length > maxBytes;
    return {
        text: truncated ? text.slice(0, maxBytes) : text,
        truncated,
    };
}
export async function writeWorkspaceText(path, content, createParents) {
    if (createParents)
        await mkdir(dirname(path.absolutePath), { recursive: true });
    await writeFile(path.absolutePath, content, 'utf8');
    return {
        bytes: new TextEncoder().encode(content).length,
    };
}
export async function listWorkspaceFiles(context, rootPath = '.', options = {}) {
    const root = resolveWorkspacePath(context, rootPath);
    const maxFiles = options.maxFiles ?? 5000;
    const files = [];
    await visit(root.absolutePath);
    return files;
    async function visit(dir) {
        if (files.length >= maxFiles)
            return;
        const entries = await readdir(dir);
        for (const entry of entries) {
            if (files.length >= maxFiles)
                return;
            if (!options.includeHidden && entry.startsWith('.'))
                continue;
            if (shouldSkipDirectory(entry))
                continue;
            const absolutePath = join(dir, entry);
            const current = resolveWorkspacePath(context, absolutePath);
            const info = await stat(absolutePath);
            if (info.isDirectory()) {
                await visit(absolutePath);
            }
            else if (info.isFile()) {
                files.push(current);
            }
        }
    }
}
export function globToRegExp(pattern) {
    const normalized = toPortablePath(pattern);
    let output = '^';
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        const next = normalized[index + 1];
        if (char === '*' && next === '*') {
            output += '.*';
            index += 1;
        }
        else if (char === '*') {
            output += '[^/]*';
        }
        else if (char === '?') {
            output += '[^/]';
        }
        else {
            output += escapeRegExp(char);
        }
    }
    output += '$';
    return new RegExp(output);
}
export function toPortablePath(path) {
    return path.split(sep).join('/').replace(/\\/g, '/');
}
export function limitedText(value, maxChars) {
    if (value.length <= maxChars)
        return { text: value, truncated: false };
    return {
        text: `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`,
        truncated: true,
    };
}
export function jsonToolResult(toolUseId, data, ok = true) {
    return createTextResult(toolUseId, JSON.stringify(data, null, 2), ok);
}
export function errorToolResult(toolUseId, error) {
    return createStructuredErrorResult(toolUseId, error);
}
export function processResultMetadata(result) {
    const ok = result.exitCode === 0 && !result.timedOut;
    return {
        ...(ok
            ? { code: 'process_completed', category: 'process' }
            : {
                type: 'tool_failure',
                code: result.timedOut ? 'process_timeout' : 'process_exit_nonzero',
                category: 'process',
                message: result.timedOut
                    ? 'Process timed out.'
                    : `Process exited with code ${result.exitCode ?? 'null'}.`,
            }),
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length,
    };
}
export async function runProcess(options) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputChars = options.maxOutputChars ?? 20_000;
    return new Promise((resolveProcess, reject) => {
        const child = spawn(options.command, options.args ?? [], {
            cwd: options.cwd,
            env: getRuntimeEnv(),
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeoutMs);
        const onAbort = () => {
            child.kill('SIGTERM');
        };
        options.abortSignal?.addEventListener('abort', onAbort, { once: true });
        child.stdout?.on('data', chunk => {
            stdout = appendLimited(stdout, String(chunk), maxOutputChars);
        });
        child.stderr?.on('data', chunk => {
            stderr = appendLimited(stderr, String(chunk), maxOutputChars);
        });
        child.on('error', error => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            options.abortSignal?.removeEventListener('abort', onAbort);
            reject(error);
        });
        child.on('close', (exitCode, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            options.abortSignal?.removeEventListener('abort', onAbort);
            resolveProcess({
                exitCode,
                signal,
                timedOut,
                stdout,
                stderr,
            });
        });
    });
}
export function defaultShellCommand(command) {
    if (platform() === 'win32') {
        return {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', command],
        };
    }
    return {
        command: '/bin/sh',
        args: ['-lc', command],
    };
}
export function powerShellCommand(command) {
    return {
        command: 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    };
}
export function processResultContent(result) {
    const sections = [
        `exitCode: ${result.exitCode ?? 'null'}`,
        `signal: ${result.signal ?? 'null'}`,
        `timedOut: ${result.timedOut}`,
        'stdout:',
        result.stdout.trimEnd(),
        'stderr:',
        result.stderr.trimEnd(),
    ];
    return sections.join('\n');
}
function assertInsideWorkspace(workspace, target) {
    const relativePath = relative(workspace, target);
    if (relativePath === '')
        return;
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error(`Path is outside workspace: ${target}`);
    }
}
function shouldSkipDirectory(name) {
    return ['.git', 'node_modules', 'dist'].includes(name);
}
function escapeRegExp(value) {
    return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
}
function appendLimited(base, chunk, maxChars) {
    const next = base + chunk;
    if (next.length <= maxChars)
        return next;
    return next.slice(0, maxChars);
}
function getRuntimeEnv() {
    const runtime = globalThis;
    return runtime.process?.env ?? {};
}
