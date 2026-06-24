import { AtomicFileStore } from '../store/index.js';
export class RuntimeStateStore {
    paths;
    atomic = new AtomicFileStore();
    constructor(paths) {
        this.paths = paths;
    }
    readState(name) {
        return this.atomic.readJson(this.paths.statePath(name));
    }
    writeState(name, value) {
        return this.atomic.writeJson(this.paths.statePath(name), value);
    }
}
