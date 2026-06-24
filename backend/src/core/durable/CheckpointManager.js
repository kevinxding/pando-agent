import { CheckpointStore } from './CheckpointStore.js';
// Compatibility wrapper. New code should access checkpoint operations through DurableRuntime.
export class CheckpointManager extends CheckpointStore {
}
