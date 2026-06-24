export const REPLAY_EVENT_TYPES = {
    reportRequested: 'replay_report_requested',
    reportGenerated: 'replay_report_generated',
    reportFailed: 'replay_report_failed',
    incidentDetected: 'replay_incident_detected',
    exportCreated: 'replay_export_created',
    queryRejected: 'replay_query_rejected',
};
export function isReplayEventType(value) {
    return Object.values(REPLAY_EVENT_TYPES).includes(value);
}
