const SHELL_WRITE_PATTERN = /\b(rm|mv|cp|chmod|chown|sudo|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish)\b|git\s+(push|reset|checkout\s+--|clean)|curl\b.*\|/i;
const GUI_WRITE_PATTERN = /click|type|submit|delete|publish|payment|drag|press|key|write|send/i;
export class SideEffectClassifier {
    classifyMany(hints = []) {
        return hints.map((hint, index) => this.classify(hint, index));
    }
    classify(hint, index = 0) {
        const effectType = hint.effectType ?? inferEffectType(hint);
        const autoRecoverable = isAutoRecoverable(effectType);
        return {
            effectId: hint.effectId ?? `effect_${Date.now()}_${index}`,
            effectType,
            autoRecoverable,
            requiresHuman: !autoRecoverable,
            summary: hint.summary ?? summarizeHint(hint, effectType),
            confirmed: hint.confirmed ?? false,
        };
    }
}
export function isAutoRecoverableEffect(effectType) {
    return isAutoRecoverable(effectType);
}
function inferEffectType(hint) {
    if (hint.source === 'model')
        return 'model_request';
    if (hint.source === 'gateway')
        return hint.action === 'outbound' || hint.action === 'send' ? 'gateway_outbound' : 'gateway_inbound';
    if (hint.source === 'gui') {
        if (hint.effectType)
            return hint.effectType;
        return hint.action && /submit|delete|publish|payment|confirm|install|system_setting|close_without_save/i.test(hint.action) ? 'gui_dangerous_write' : hint.action && GUI_WRITE_PATTERN.test(hint.action) ? 'gui_write' : 'gui_read';
    }
    if (hint.source === 'mcp')
        return isWriteAction(hint.action ?? hint.toolName) ? 'mcp_write' : 'mcp_read';
    if (hint.source === 'file')
        return isWriteAction(hint.action) ? 'file_write' : 'file_read';
    if (hint.source === 'shell')
        return hint.command && SHELL_WRITE_PATTERN.test(hint.command) ? 'shell_write' : 'shell_readonly';
    if (hint.toolName)
        return isWriteAction(hint.toolName) ? 'mcp_write' : 'readonly_tool';
    return 'unknown_external';
}
function isWriteAction(value) {
    return Boolean(value && /write|delete|remove|move|copy|send|post|put|patch|publish|create|update|edit/i.test(value));
}
function isAutoRecoverable(effectType) {
    return effectType === 'readonly_tool' ||
        effectType === 'file_read' ||
        effectType === 'shell_readonly' ||
        effectType === 'gui_read' ||
        effectType === 'gateway_inbound' ||
        effectType === 'model_request' ||
        effectType === 'mcp_read';
}
function summarizeHint(hint, effectType) {
    return hint.command ?? hint.action ?? hint.toolName ?? effectType;
}
