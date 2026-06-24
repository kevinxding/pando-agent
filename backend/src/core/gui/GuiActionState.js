export const GUI_TERMINAL_STATES = new Set([
    'rejected',
    'completed',
    'failed',
    'verified',
    'stuck',
    'recovery_required',
]);
export function isTerminalGuiActionState(state) {
    return GUI_TERMINAL_STATES.has(state);
}
