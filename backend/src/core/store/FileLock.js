export class FileLock {
    tails = new Map();
    async withLock(key, run) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release = () => undefined;
        const tail = new Promise(resolve => {
            release = resolve;
        });
        this.tails.set(key, previous.then(() => tail, () => tail));
        await previous.catch(() => undefined);
        try {
            return await run();
        }
        finally {
            release();
            if (this.tails.get(key) === tail)
                this.tails.delete(key);
        }
    }
}
