export function isDangerousGuiAction(action) {
    const normalized = action.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
    return [
        'send',
        'delete',
        'pay',
        'payment',
        'submit',
        'submit_form',
        'publish',
        'post',
        'modify_system_settings',
        'system_settings',
        'close_save_dialog',
        'close_unsaved_dialog',
    ].includes(normalized);
}
