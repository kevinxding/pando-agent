export const GUI_EVENT_TYPES = {
    observationStarted: 'gui_observation_started',
    observationCompleted: 'gui_observation_completed',
    actionRequested: 'gui_action_requested',
    actionApprovalRequired: 'gui_action_approval_required',
    actionApproved: 'gui_action_approved',
    actionRejected: 'gui_action_rejected',
    actionStarted: 'gui_action_started',
    actionCompleted: 'gui_action_completed',
    actionFailed: 'gui_action_failed',
    actionVerified: 'gui_action_verified',
    actionStuck: 'gui_action_stuck',
    actionRecoveryDecided: 'gui_action_recovery_decided',
    inputReleased: 'gui_input_released',
    legacyEventBridged: 'gui_legacy_event_bridged',
};
export function isGuiEventType(value) {
    return Object.values(GUI_EVENT_TYPES).includes(value);
}
