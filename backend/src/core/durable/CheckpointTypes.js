export function validateCheckpoint(checkpoint, latestEventSeq) {
    if (checkpoint.lastEventSeq > latestEventSeq) {
        throw new Error(`Checkpoint ${checkpoint.checkpointId} references future event seq ${checkpoint.lastEventSeq}`);
    }
    const payloadText = checkpoint.payload === undefined ? '' : JSON.stringify(checkpoint.payload);
    if (payloadText.length > 200_000) {
        throw new Error(`Checkpoint ${checkpoint.checkpointId} payload is too large; use snapshotRef or summary`);
    }
}
