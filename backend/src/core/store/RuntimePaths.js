import { join, resolve } from 'node:path';
export class RuntimePaths {
    workspaceRoot;
    workspaceId;
    root;
    constructor(input) {
        this.workspaceRoot = resolve(input.workspaceRoot);
        this.workspaceId = input.workspaceId ?? 'default';
        this.root = join(this.workspaceRoot, '.pandoshare', 'core');
    }
    eventsPath() {
        return join(this.root, 'events', `${safeId(this.workspaceId)}.jsonl`);
    }
    eventSeqPath() {
        return join(this.root, 'state', `${safeId(this.workspaceId)}-event-seq.json`);
    }
    checkpointsPath() {
        return join(this.root, 'checkpoints', `${safeId(this.workspaceId)}.jsonl`);
    }
    heartbeatsPath() {
        return join(this.root, 'heartbeats', `${safeId(this.workspaceId)}.jsonl`);
    }
    runSnapshotsPath() {
        return join(this.root, 'run-snapshots', `${safeId(this.workspaceId)}.jsonl`);
    }
    statePath(name) {
        return join(this.root, 'state', `${safeId(name)}.json`);
    }
    queuePath(name) {
        return join(this.root, 'queues', `${safeId(name)}.jsonl`);
    }
}
export function safeId(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(`Invalid runtime id: ${value}`);
    return value;
}
