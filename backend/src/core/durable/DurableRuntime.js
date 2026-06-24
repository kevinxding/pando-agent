import { JsonlStore, RuntimePaths } from '../store/index.js';
import { CheckpointManager } from './CheckpointManager.js';
import { ConsistencyAudit } from './ConsistencyAudit.js';
import { EventIndex } from './EventIndex.js';
import { EventStore } from './EventStore.js';
import { HeartbeatManager } from './HeartbeatManager.js';
import { RecoveryPlanner } from './RecoveryPlanner.js';
import { RunLedgerStore } from './RunLedgerStore.js';
import { RunSnapshotStore } from './RunSnapshotStore.js';
import { RuntimeStateStore } from './RuntimeStateStore.js';
export class DurableRuntime {
    paths;
    eventStore;
    eventIndex;
    checkpointManager;
    heartbeatManager;
    runSnapshotStore;
    runLedgerStore;
    stateStore;
    recoveryPlanner = new RecoveryPlanner();
    consistencyAudit = new ConsistencyAudit();
    constructor(input) {
        this.paths = new RuntimePaths(input);
        this.eventStore = new EventStore(this.paths);
        this.eventIndex = new EventIndex(this.eventStore);
        this.checkpointManager = new CheckpointManager(new JsonlStore(this.paths.checkpointsPath()));
        this.heartbeatManager = new HeartbeatManager(new JsonlStore(this.paths.heartbeatsPath()));
        this.runSnapshotStore = new RunSnapshotStore(new JsonlStore(this.paths.runSnapshotsPath()));
        this.runLedgerStore = RunLedgerStore.fromRuntimePaths(this.paths);
        this.stateStore = new RuntimeStateStore(this.paths);
    }
    appendEvent(input, options) {
        return this.eventStore.append(input, options);
    }
    appendEvents(inputs, options) {
        return this.eventStore.appendMany(inputs, options);
    }
    async createCheckpoint(input) {
        const latestSeq = await this.eventStore.latestSeq();
        const checkpoint = await this.checkpointManager.createCheckpoint(input, latestSeq);
        await this.appendEvent({
            eventType: 'checkpoint',
            workspaceId: checkpoint.workspaceId,
            threadId: checkpoint.threadId,
            runId: checkpoint.runId,
            goalId: checkpoint.goalId,
            loopId: checkpoint.loopId,
            payload: checkpoint,
        });
        return checkpoint;
    }
    async writeRunSnapshot(input) {
        if (input.lastEventSeq > 0 && !(await this.eventStore.hasSeq(input.lastEventSeq))) {
            throw new Error(`RunSnapshot references missing event seq ${input.lastEventSeq}`);
        }
        return this.runSnapshotStore.writeSnapshot(input);
    }
    appendRunLedger(entry) {
        return this.runLedgerStore.append(entry);
    }
    readRun(runId) {
        return this.runLedgerStore.readRun(runId);
    }
    readActiveRuns() {
        return this.runLedgerStore.readActiveRuns();
    }
    readRecentRuns(limit = 20) {
        return this.runLedgerStore.readRecentRuns(limit);
    }
    async writeHeartbeat(input) {
        const lastSeq = input.lastSeq ?? await this.eventStore.latestSeq();
        const heartbeat = await this.heartbeatManager.writeHeartbeat({
            ...input,
            lastSeq,
        });
        await this.appendEvent({
            eventType: 'heartbeat',
            workspaceId: heartbeat.workspaceId,
            runId: heartbeat.runId,
            loopId: heartbeat.loopId,
            payload: heartbeat,
        });
        return heartbeat;
    }
    readRunEvents(runId) {
        return this.eventIndex.readRunEvents(runId);
    }
    readThreadEvents(threadId) {
        return this.eventIndex.readThreadEvents(threadId);
    }
    readLatestCheckpoint(runId) {
        return this.checkpointManager.readLatestCheckpoint({ runId });
    }
    readRunSnapshots(runId) {
        return this.runSnapshotStore.readSnapshots(runId);
    }
    readHeartbeat(workerId) {
        return this.heartbeatManager.readHeartbeat(workerId);
    }
    async decideRecovery(input) {
        const runId = input.runId;
        const latestRun = await this.readRun(runId);
        const latestSnapshot = await this.runSnapshotStore.readLatestSnapshot(runId);
        const latestCheckpoint = await this.checkpointManager.readLatestCheckpoint({ runId });
        const events = await this.readRunEvents(runId);
        const latestHeartbeat = input.workerId
            ? await this.heartbeatManager.readHeartbeat(input.workerId)
            : await this.heartbeatManager.readRunHeartbeat(runId);
        const nowMs = input.nowMs ?? Date.now();
        const heartbeatAgeMs = latestHeartbeat ? nowMs - latestHeartbeat.lastHeartbeatAtMs : undefined;
        const heartbeatTtlMs = input.heartbeatTtlMs ?? 30_000;
        return this.recoveryPlanner.decide({
            runId,
            latestRun,
            latestSnapshot,
            latestCheckpoint,
            events,
            latestHeartbeat,
            heartbeatAgeMs,
            heartbeatTtlMs,
            corruptionErrors: await this.detectCorruption(runId),
        });
    }
    async auditRun(runId) {
        const events = await this.readRunEvents(runId);
        const checkpoints = await this.checkpointManager.readCheckpoints({ runId });
        const snapshots = await this.runSnapshotStore.readSnapshots(runId);
        const latestRun = await this.readRun(runId);
        const recoveryDecision = await this.decideRecovery({ runId });
        const corruptionWarnings = await this.readCorruptionWarnings();
        const result = this.consistencyAudit.run({
            runId,
            events,
            checkpoints,
            snapshots,
            latestRun,
            recoveryDecision,
            corruptionWarnings,
        });
        if (result.errors.length) {
            await this.appendCorruptionDetected(runId, result.errors);
        }
        return result;
    }
    async createMaintenanceReport(input = {}) {
        const eventRead = await this.eventStore.readWithCorruption();
        const checkpointRead = await this.checkpointManager.readWithCorruption();
        const snapshotRead = await this.runSnapshotStore.readWithCorruption();
        const heartbeatRead = await this.heartbeatManager.readWithCorruption();
        const heartbeats = heartbeatRead.records;
        const nowMs = input.nowMs ?? Date.now();
        const heartbeatTtlMs = input.heartbeatTtlMs ?? 30_000;
        return {
            latestSeq: eventRead.records.reduce((latest, event) => Math.max(latest, event.seq), 0),
            eventCount: eventRead.records.length,
            corruptRecordCount: eventRead.corruptRecords.length + checkpointRead.corruptRecords.length + snapshotRead.corruptRecords.length + heartbeatRead.corruptRecords.length,
            activeRuns: await this.readActiveRuns(),
            staleHeartbeats: heartbeats.filter(heartbeat => nowMs - heartbeat.lastHeartbeatAtMs > heartbeatTtlMs),
            recentCorruptionEvents: eventRead.records
                .filter(event => event.eventType === 'run_corruption_detected')
                .sort((left, right) => right.seq - left.seq)
                .slice(0, 20),
        };
    }
    repairSeqFromEventsForMaintenance() {
        return this.eventStore.repairSeqFromEvents();
    }
    async readEvents(input = {}) {
        return this.eventStore.readEvents(input);
    }
    async readCheckpoints(input = {}) {
        return this.checkpointManager.readCheckpoints(input);
    }
    async detectCorruption(runId) {
        const events = await this.readRunEvents(runId);
        const eventSeqs = new Set(events.map(event => event.seq));
        const checkpoints = await this.checkpointManager.readCheckpoints({ runId });
        const snapshots = await this.runSnapshotStore.readSnapshots(runId);
        const latestRun = await this.readRun(runId);
        const latestSnapshot = snapshots.sort((left, right) => right.lastEventSeq - left.lastEventSeq)[0];
        const errors = [];
        for (const checkpoint of checkpoints) {
            if (checkpoint.lastEventSeq > 0 && !eventSeqs.has(checkpoint.lastEventSeq)) {
                errors.push(`checkpoint ${checkpoint.checkpointId} references missing event seq ${checkpoint.lastEventSeq}`);
            }
        }
        for (const snapshot of snapshots) {
            if (snapshot.lastEventSeq > 0 && !eventSeqs.has(snapshot.lastEventSeq)) {
                errors.push(`snapshot ${snapshot.snapshotId} references missing event seq ${snapshot.lastEventSeq}`);
            }
        }
        if (latestRun && latestSnapshot && latestRun.status !== latestSnapshot.status) {
            errors.push(`run ledger status ${latestRun.status} drifts from snapshot status ${latestSnapshot.status}`);
        }
        return errors;
    }
    async readCorruptionWarnings() {
        const [events, checkpoints, snapshots, heartbeats] = await Promise.all([
            this.eventStore.readWithCorruption(),
            this.checkpointManager.readWithCorruption(),
            this.runSnapshotStore.readWithCorruption(),
            this.heartbeatManager.readWithCorruption(),
        ]);
        return [
            ...events.corruptRecords.map(record => `event jsonl corruption line ${record.lineNumber}: ${record.message}`),
            ...checkpoints.corruptRecords.map(record => `checkpoint jsonl corruption line ${record.lineNumber}: ${record.message}`),
            ...snapshots.corruptRecords.map(record => `snapshot jsonl corruption line ${record.lineNumber}: ${record.message}`),
            ...heartbeats.corruptRecords.map(record => `heartbeat jsonl corruption line ${record.lineNumber}: ${record.message}`),
        ];
    }
    async appendCorruptionDetected(runId, errors) {
        const digest = errors.join('|').slice(0, 1000);
        const existing = (await this.readRunEvents(runId)).some(event => event.eventType === 'run_corruption_detected' &&
            typeof event.payload === 'object' &&
            event.payload !== null &&
            'digest' in event.payload &&
            event.payload.digest === digest);
        if (existing)
            return;
        await this.appendEvent({
            eventType: 'run_corruption_detected',
            workspaceId: this.paths.workspaceId,
            runId,
            payload: {
                digest,
                errors,
            },
        });
    }
}
