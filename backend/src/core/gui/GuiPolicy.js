const READ_ONLY = new Set(['observe', 'screenshot', 'compare_observations', 'analyze_grid']);
const LOW_WRITE = new Set(['move_mouse', 'move', 'hover', 'focus']);
const WRITE = new Set(['click', 'fast_click', 'type', 'type_text', 'key', 'hotkey', 'mouse_down', 'mouse_up', 'drag', 'draw_path', 'draw_paths', 'set_key_state', 'press_key', 'shortcut', 'release_all']);
const DANGEROUS = new Set(['submit', 'delete', 'publish', 'payment', 'confirm', 'install', 'system_setting', 'close_without_save']);
export function classifyGuiAction(action) {
    const name = normalizeAction(action.action);
    if (action.riskHint === 'dangerous_write')
        return { level: 'dangerous_write', action: name, reason: 'explicit riskHint=dangerous_write' };
    if (action.riskHint === 'write')
        return { level: 'write', action: name, reason: 'explicit riskHint=write' };
    if (action.riskHint === 'read_only')
        return { level: 'read_only', action: name, reason: 'explicit riskHint=read_only' };
    if (DANGEROUS.has(name))
        return { level: 'dangerous_write', action: name, reason: `${name} is dangerous GUI write` };
    if (WRITE.has(name))
        return { level: 'write', action: name, reason: `${name} mutates GUI state` };
    if (LOW_WRITE.has(name))
        return { level: 'low_write', action: name, reason: `${name} is low-risk GUI write` };
    if (READ_ONLY.has(name))
        return { level: 'read_only', action: name, reason: `${name} is read-only GUI action` };
    return { level: 'dangerous_write', action: name, reason: `unknown GUI action defaults to dangerous_write: ${name}` };
}
export function requiresGuiApproval(action, policy) {
    const risk = classifyGuiAction(action);
    if (policy === 'trusted')
        return false;
    if (risk.level === 'read_only' || risk.level === 'low_write')
        return false;
    return risk.level === 'write' || risk.level === 'dangerous_write';
}
export function toGuiSideEffect(action, guiActionId) {
    const risk = classifyGuiAction(action);
    return {
        effectId: guiActionId ? `effect_${guiActionId}` : undefined,
        source: 'gui',
        action: risk.action,
        effectType: risk.level === 'read_only' ? 'gui_read' : risk.level === 'dangerous_write' ? 'gui_dangerous_write' : 'gui_write',
        summary: `${risk.level}: ${risk.action}`,
        confirmed: risk.level === 'read_only',
    };
}
export function normalizeAction(action) {
    return action.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}
