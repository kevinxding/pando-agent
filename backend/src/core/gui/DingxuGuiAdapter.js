import { runGuiAction } from '../../services/gui/index.js';
import { createGuiObservationId } from './GuiIdentity.js';
export class DingxuGuiAdapter {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    async observe() {
        const screenshot = await this.backend?.screenshot?.({ action: 'observe' });
        const now = Date.now();
        return {
            observationId: createGuiObservationId(now),
            createdAtMs: now,
            screenshotRef: screenshot?.screenshotPath,
            summary: screenshot?.message ?? 'GUI observation captured through Dingxu adapter.',
            source: 'dingxu',
            confidence: screenshot?.ok === false ? 0.2 : 0.8,
        };
    }
    async act(action) {
        const result = await runGuiAction(toLegacyRequest(action), this.backend);
        return {
            ok: result.ok,
            method: result.method,
            message: result.message,
            screenshotRef: result.screenshotPath,
            screenshotPath: result.screenshotPath,
            fallbackUsed: result.fallbackUsed,
            failureClass: result.failureClass,
            audit: result.audit,
        };
    }
    async verify(action, context) {
        const screenshot = await this.backend?.screenshot?.(toLegacyRequest(action));
        if (!screenshot) {
            return {
                ok: false,
                status: 'inconclusive',
                message: 'Dingxu GUI backend has no verification screenshot capability.',
                beforeObservationId: context?.guiActionId,
                visualChange: 'unknown',
                reasonCode: 'verification_backend_missing',
            };
        }
        return {
            ok: screenshot.ok === true,
            status: screenshot.ok ? 'passed' : 'failed',
            message: screenshot.message ?? (screenshot.ok ? 'Dingxu GUI verification passed.' : 'Dingxu GUI verification failed.'),
            screenshotRef: screenshot.screenshotPath,
            visualChange: screenshot.ok ? 'changed' : 'unknown',
            confidence: screenshot.ok ? 0.8 : 0.2,
            reasonCode: screenshot.failureClass,
        };
    }
}
export class MockGuiAdapter {
    async observe() {
        const now = Date.now();
        return {
            observationId: createGuiObservationId(now),
            createdAtMs: now,
            summary: 'Mock GUI observation.',
            source: 'mock',
            confidence: 1,
        };
    }
    async act(action) {
        return {
            ok: true,
            method: 'mock',
            message: `Mock GUI action completed: ${action.action}`,
        };
    }
    async verify() {
        return {
            ok: true,
            status: 'passed',
            message: 'Mock GUI verification completed.',
            visualChange: 'changed',
            confidence: 1,
        };
    }
}
function toLegacyRequest(action) {
    return {
        ...action,
        verify: typeof action.verify === 'boolean' || typeof action.verify === 'string' ? action.verify : action.verify ? true : undefined,
    };
}
