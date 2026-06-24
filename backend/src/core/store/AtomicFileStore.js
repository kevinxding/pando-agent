import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class AtomicFileStore {
    async readJson(path) {
        if (!(await exists(path)))
            return undefined;
        return JSON.parse(await readFile(path, 'utf8'));
    }
    async writeJson(path, value) {
        await mkdir(dirname(path), { recursive: true });
        const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
        await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await rename(tmpPath, path);
    }
    async writeIfMissing(path, content) {
        if (await exists(path))
            return false;
        await mkdir(dirname(path), { recursive: true });
        const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
        try {
            await writeFile(tmpPath, content, 'utf8');
            if (await exists(path)) {
                await unlink(tmpPath);
                return false;
            }
            await rename(tmpPath, path);
            return true;
        }
        catch (error) {
            await unlink(tmpPath).catch(() => undefined);
            if (isAlreadyExists(error))
                return false;
            throw error;
        }
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
function isAlreadyExists(error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
