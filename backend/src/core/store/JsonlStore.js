import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
export class JsonlStore {
    path;
    constructor(path) {
        this.path = path;
    }
    async append(record) {
        await this.appendLine(record);
    }
    async appendLocked(record, lock, options = {}) {
        await lock.withLock({ reason: `jsonl append ${this.path}`, ...options }, async () => {
            await this.appendLine(record);
        });
    }
    async appendManyLocked(records, lock, options = {}) {
        await lock.withLock({ reason: `jsonl append many ${this.path}`, ...options }, async () => {
            for (const record of records) {
                await this.appendLine(record);
            }
        });
    }
    async read() {
        return this.readWithCorruption();
    }
    async readWithCorruption() {
        if (!(await exists(this.path)))
            return { records: [], corruptRecords: [] };
        const text = await readFile(this.path, 'utf8');
        const records = [];
        const corruptRecords = [];
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (!line.trim())
                return;
            try {
                records.push(JSON.parse(line));
            }
            catch (error) {
                corruptRecords.push({
                    lineNumber: index + 1,
                    linePreview: line.slice(0, 500),
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        });
        return { records, corruptRecords };
    }
    async readRecords() {
        return (await this.read()).records;
    }
    async appendLine(record) {
        const line = JSON.stringify(record);
        if (typeof line !== 'string')
            throw new Error('JSONL record is not serializable');
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${line}\n`, 'utf8');
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
