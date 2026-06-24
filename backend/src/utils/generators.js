const NO_VALUE = Symbol('NO_VALUE');
export async function lastValue(source) {
    let value = NO_VALUE;
    for await (const item of source) {
        value = item;
    }
    if (value === NO_VALUE) {
        throw new Error('No items in async iterable');
    }
    return value;
}
export async function toArray(source) {
    const values = [];
    for await (const item of source) {
        values.push(item);
    }
    return values;
}
export async function* fromArray(values) {
    for (const value of values) {
        yield value;
    }
}
function nextQueued(iterator) {
    let promise;
    promise = iterator.next().then(({ done, value }) => ({
        done,
        value,
        iterator,
        promise,
    }));
    return promise;
}
export async function* all(sources, concurrencyCap = Number.POSITIVE_INFINITY) {
    if (concurrencyCap < 1) {
        throw new Error('concurrencyCap must be at least 1');
    }
    const waiting = sources.map(source => source[Symbol.asyncIterator]());
    const running = new Set();
    while (running.size < concurrencyCap && waiting.length > 0) {
        running.add(nextQueued(waiting.shift()));
    }
    while (running.size > 0) {
        const queued = await Promise.race(running);
        running.delete(queued.promise);
        if (!queued.done) {
            running.add(nextQueued(queued.iterator));
            if (queued.value !== undefined) {
                yield queued.value;
            }
        }
        else if (waiting.length > 0) {
            running.add(nextQueued(waiting.shift()));
        }
    }
}
