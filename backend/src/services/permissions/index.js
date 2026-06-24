import { emitAgentEvent, eventBase, summarizeToolUse } from '../events/index.js';
export function permissionPreset(preset) {
    switch (preset) {
        case 'ask-for-approval':
            return {
                approvalPolicy: 'on-request',
                approvalsReviewer: 'user',
                sandboxMode: 'workspace-write',
            };
        case 'auto-approve':
            return {
                approvalPolicy: 'on-request',
                approvalsReviewer: 'auto_review',
                sandboxMode: 'workspace-write',
            };
        case 'full-access':
            return {
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandboxMode: 'danger-full-access',
            };
        case 'read-only':
            return {
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandboxMode: 'read-only',
            };
    }
}
export function resolvePermissionConfig(context) {
    if (context.permissions)
        return normalizePermissionConfig(context.permissions);
    switch (context.permissionMode) {
        case 'plan':
        case 'restricted':
            return permissionPreset('read-only');
        case 'auto':
            return permissionPreset('auto-approve');
        case 'default':
            return permissionPreset('ask-for-approval');
    }
}
export async function authorizeToolUse(tool, toolUse, context) {
    const permissions = resolvePermissionConfig(context);
    if (sandboxAllows(tool.safety, permissions.sandboxMode)) {
        return {
            approved: true,
            permissions,
            reason: `Tool ${tool.name} is allowed by ${permissions.sandboxMode}.`,
            source: 'sandbox',
        };
    }
    const request = buildApprovalRequest(tool, toolUse, permissions);
    await emitApprovalRequested(context, request);
    if (!wantsApprovalRequest(tool, permissions)) {
        await emitApprovalCompleted(context, request, false, 'sandbox', `Tool ${tool.name} is blocked by ${permissions.sandboxMode} and approval policy ${permissions.approvalPolicy}.`);
        return {
            approved: false,
            permissions,
            reason: `Tool ${tool.name} is blocked by ${permissions.sandboxMode} and approval policy ${permissions.approvalPolicy}.`,
            code: 'sandbox_denied',
            request,
        };
    }
    if (permissions.approvalsReviewer === 'auto_review') {
        const autoDecision = autoReview(request, permissions);
        if (autoDecision.approved) {
            await emitApprovalCompleted(context, request, true, 'auto_review', autoDecision.reason ?? `Tool ${tool.name} was approved by auto_review.`);
            return {
                approved: true,
                permissions,
                reason: autoDecision.reason ?? `Tool ${tool.name} was approved by auto_review.`,
                source: 'auto_review',
            };
        }
    }
    if (!context.requestToolApproval) {
        await emitApprovalCompleted(context, request, false, request.approvalsReviewer, `Tool ${tool.name} requires approval: ${request.reason}`);
        return {
            approved: false,
            permissions,
            reason: `Tool ${tool.name} requires approval: ${request.reason}`,
            code: 'approval_required',
            request,
        };
    }
    const userDecision = normalizeApprovalDecision(await context.requestToolApproval(request));
    if (!userDecision.approved) {
        await emitApprovalCompleted(context, request, false, request.approvalsReviewer, userDecision.reason ?? `Approval denied for tool ${tool.name}.`);
        return {
            approved: false,
            permissions,
            reason: userDecision.reason ?? `Approval denied for tool ${tool.name}.`,
            code: 'approval_denied',
            request,
        };
    }
    await emitApprovalCompleted(context, request, true, request.approvalsReviewer, userDecision.reason ?? `Tool ${tool.name} was approved.`);
    return {
        approved: true,
        permissions,
        reason: userDecision.reason ?? `Tool ${tool.name} was approved.`,
        source: 'user',
    };
}
async function emitApprovalRequested(context, request) {
    await emitAgentEvent(context, {
        ...eventBase(context, 'approval_requested'),
        type: 'approval_requested',
        toolUseId: request.toolUse.id,
        toolName: request.toolName,
        safety: request.safety,
        approvalPolicy: request.approvalPolicy,
        approvalsReviewer: request.approvalsReviewer,
        sandboxMode: request.sandboxMode,
        risk: request.risk,
        reason: request.reason,
        input: summarizeToolUse(request.toolUse),
    });
}
async function emitApprovalCompleted(context, request, approved, reviewer, reason) {
    await emitAgentEvent(context, {
        ...eventBase(context, 'approval_completed'),
        type: 'approval_completed',
        toolUseId: request.toolUse.id,
        toolName: request.toolName,
        approved,
        reviewer,
        reason,
    });
}
function normalizePermissionConfig(config) {
    return {
        ...config,
        approvalsReviewer: config.approvalsReviewer ?? 'user',
    };
}
function sandboxAllows(safety, sandboxMode) {
    if (sandboxMode === 'danger-full-access')
        return true;
    if (safety === 'read_only')
        return true;
    if (sandboxMode === 'workspace-write' && safety === 'workspace_write')
        return true;
    return false;
}
function wantsApprovalRequest(tool, permissions) {
    switch (permissions.approvalPolicy) {
        case 'never':
            return false;
        case 'granular':
            return permissions.granular?.sandboxApproval === true;
        case 'unless-trusted':
            return !isTrustedTool(tool, permissions);
        case 'on-failure':
        case 'on-request':
            return true;
    }
}
function isTrustedTool(tool, permissions) {
    return Boolean(permissions.trustedTools?.some(name => name.toLowerCase() === tool.name.toLowerCase()));
}
function buildApprovalRequest(tool, toolUse, permissions) {
    return {
        toolUse,
        toolName: tool.name,
        safety: tool.safety,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer ?? 'user',
        sandboxMode: permissions.sandboxMode,
        reason: approvalReason(tool.safety, permissions.sandboxMode),
        risk: approvalRisk(tool.safety),
    };
}
function approvalReason(safety, sandboxMode) {
    switch (safety) {
        case 'workspace_write':
            return `workspace write is not allowed by ${sandboxMode}`;
        case 'gui_write':
            return `GUI write may affect real desktop applications and is not allowed by ${sandboxMode}`;
        case 'external_write':
            return `external command or external write is not allowed by ${sandboxMode}`;
        case 'read_only':
            return `read-only tool unexpectedly required approval under ${sandboxMode}`;
    }
}
function approvalRisk(safety) {
    switch (safety) {
        case 'read_only':
            return 'low';
        case 'workspace_write':
            return 'medium';
        case 'gui_write':
        case 'external_write':
            return 'high';
    }
}
function autoReview(request, permissions) {
    if (permissions.sandboxMode === 'workspace-write' && request.safety === 'workspace_write') {
        return { approved: true, reason: 'workspace_write is allowed by auto_review under workspace-write.' };
    }
    return { approved: false, reason: 'auto_review requires user approval for high-risk tool use.' };
}
function normalizeApprovalDecision(decision) {
    if (typeof decision === 'boolean')
        return { approved: decision };
    return decision;
}
