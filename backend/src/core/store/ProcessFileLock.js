import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export class ProcessFileLock {
    targetPath;
    constructor(targetPath) {
        this.targetPath = targetPath;
    }
    get lockPath() {
        return `${this.targetPath}.lock`;
    }
    async acquire(options = {}) {
        const timeoutMs = options.timeoutMs ?? 10_000;
        const staleMs = options.staleMs ?? 30_000;
        const retryDelayMs = options.retryDelayMs ?? 25;
        const startedAtMs = Date.now();
        const record = {
            lockToken: `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
            pid: currentPid(),
            createdAtMs: Date.now(),
            hostname: 'unknown',
            reason: options.reason,
        };
        let staleTakeover = false;
        while (true) {
            try {
                await mkdir(dirname(this.lockPath), { recursive: true });
                await mkdir(this.lockPath);
                await writeFile(this.recordPath(), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
                return this.handle(record.lockToken, staleTakeover);
            }
            catch (error) {
                if (!isAlreadyExists(error))
                    throw error;
                if (await this.tryTakeoverStaleLock(staleMs)) {
                    staleTakeover = true;
                    continue;
                }
                if (Date.now() - startedAtMs >= timeoutMs) {
                    throw new Error(`Timed out acquiring process file lock: ${this.lockPath}`);
                }
                await delay(retryDelayMs);
            }
        }
    }
    async withLock(options, run) {
        const handle = await this.acquire(options);
        try {
            return await run();
        }
        finally {
            await handle.release();
        }
    }
    handle(lockToken, staleTakeover) {
        return {
            lockPath: this.lockPath,
            lockToken,
            staleTakeover,
            release: async () => {
                const current = await this.readLockRecord().catch(() => undefined);
                if (!current || current.lockToken !== lockToken)
                    return;
                await rm(this.lockPath, { recursive: true, force: true });
            },
        };
    }
    async tryTakeoverStaleLock(staleMs) {
        if (!(await exists(this.lockPath)))
            return true;
        const current = await this.readLockRecord().catch(() => undefined);
        const createdAtMs = current?.createdAtMs ?? Date.now();
        if (Date.now() - createdAtMs < staleMs)
            return false;
        await writeFile(`${this.lockPath}.stale-${Date.now()}`, `${JSON.stringify({ staleTakenOverAtMs: Date.now(), previous: current }, null, 2)}\n`, 'utf8');
        await rm(this.lockPath, { recursive: true, force: true });
        return true;
    }
    async readLockRecord() {
        return JSON.parse(await readFile(this.recordPath(), 'utf8'));
    }
    recordPath() {
        return join(this.lockPath, 'owner.json');
    }
}
async function exists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
function currentPid() {
    return globalThis.process?.pid ?? 0;
}
function isAlreadyExists(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
