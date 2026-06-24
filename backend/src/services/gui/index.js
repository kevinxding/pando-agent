const REQUIRED_DINGXU_HUMAN_GUI_TOOLS = [
    'human_gui_observe',
    'human_gui_mark_point',
    'human_gui_confirm_point',
    'human_gui_analyze_grid',
    'human_gui_fast_click',
    'human_gui_reflex_click',
    'human_gui_execute_click',
    'human_gui_execute_mouse',
    'human_gui_draw_path',
    'human_gui_draw_paths',
    'human_gui_execute_keys',
    'human_gui_set_key_state',
    'human_gui_set_mouse_button_state',
    'human_gui_type_text',
    'human_gui_wait',
    'human_gui_wait_for_change',
    'human_gui_wait_until_stable',
    'human_gui_compare_observations',
    'human_gui_release_all',
    'human_gui_run_sequence',
];
export async function runGuiAction(request, backend) {
    if (!backend) {
        return {
            ok: false,
            method: 'none',
            message: 'GUI backend is not configured.',
            failureClass: 'backend_missing',
        };
    }
    const uiaResult = shouldSkipUia(request.action) ? undefined : backend.uiaAction ? await backend.uiaAction(request) : undefined;
    if (uiaResult?.ok)
        return await withVerification(request, backend, toGuiResult('uia', uiaResult, false));
    const visualResult = backend.visualAction ? await backend.visualAction(request) : undefined;
    if (visualResult?.ok) {
        const method = visualResult.method && visualResult.method !== 'none' ? visualResult.method : 'visual';
        return await withVerification(request, backend, toGuiResult(method, visualResult, Boolean(uiaResult)));
    }
    return {
        ok: false,
        method: visualResult?.method ?? (visualResult ? 'visual' : uiaResult ? 'uia' : 'none'),
        message: visualResult?.message ?? uiaResult?.message ?? 'No GUI action method is available.',
        failureClass: visualResult?.failureClass ?? uiaResult?.failureClass ?? 'action_method_missing',
        fallbackUsed: Boolean(uiaResult && visualResult),
        screenshotPath: visualResult?.screenshotPath ?? uiaResult?.screenshotPath,
    };
}
export function diagnoseGuiBackend(backend) {
    const methods = {
        uia: Boolean(backend?.uiaAction),
        visual: Boolean(backend?.visualAction),
        screenshot: Boolean(backend?.screenshot),
    };
    const ok = methods.uia || methods.visual;
    const sources = backend?.sources ?? [];
    const dingxu = diagnoseDingxuHumanGui(sources);
    const capabilities = guiCapabilities(methods, sources);
    return {
        ok,
        methods,
        sources,
        dingxu,
        capabilities,
        message: ok ? 'GUI backend has at least one action method.' : 'GUI backend has no action method configured.',
    };
}
export function formatGuiDoctorReport(report) {
    const sources = report.sources.length
        ? report.sources.map(source => {
            const server = source.serverInfo?.name
                ? `${source.serverInfo.name}${source.serverInfo.version ? ` ${source.serverInfo.version}` : ''}`
                : 'unknown server';
            const error = source.error ? ` error: ${source.error}` : '';
            return `source: ${source.serverName} ${source.status} ${server} tools:${source.toolCount} human_gui:${source.humanGuiToolCount}${error}`;
        })
        : ['source: none'];
    const dingxu = report.dingxu;
    return [
        report.ok ? 'Pando GUI doctor: ok' : 'Pando GUI doctor: failed',
        `uia: ${report.methods.uia ? 'available' : 'missing'}`,
        `visual: ${report.methods.visual ? 'available' : 'missing'}`,
        `screenshot: ${report.methods.screenshot ? 'available' : 'missing'}`,
        `dingxu: ${dingxu.ok ? 'complete' : 'incomplete'}${dingxu.source ? ` source:${dingxu.source}` : ''} human_gui:${dingxu.humanGuiToolCount}/${REQUIRED_DINGXU_HUMAN_GUI_TOOLS.length}`,
        dingxu.missingTools.length ? `dingxu missing: ${dingxu.missingTools.join(', ')}` : `dingxu message: ${dingxu.message}`,
        `capabilities: ${report.capabilities.length ? report.capabilities.join(', ') : 'none'}`,
        ...sources,
        `message: ${report.message}`,
        '',
    ].join('\n');
}
export function createGuiBackendFromMcpConnections(connections) {
    const directUiaAction = findMcpTool(connections, ['uia_action', 'windows_action', 'gui_uia_action']);
    const windowsTools = createWindowsMcpToolSet(connections);
    const humanTools = createHumanGuiToolSet(connections);
    const legacyVisualAction = findMcpTool(connections, ['visual_action_with_wait', 'visual_action']);
    const visualScreenshot = findMcpTool(connections, ['visual_screenshot', 'screenshot']);
    const windowsScreenshot = windowsTools?.screenshot;
    const uiaAction = directUiaAction
        ? (request) => callMcpGuiTool(directUiaAction, request)
        : windowsTools
            ? (request) => runWindowsMcpAction(request, windowsTools)
            : undefined;
    if (!humanTools && !legacyVisualAction && !visualScreenshot && !windowsScreenshot && !uiaAction)
        return undefined;
    return {
        sources: summarizeGuiBackendSources(connections),
        uiaAction,
        visualAction: humanTools
            ? request => runHumanGuiAction(request, humanTools)
            : legacyVisualAction
                ? request => runVisualMcpAction(request, legacyVisualAction)
                : undefined,
        screenshot: humanTools?.observe
            ? () => callHumanGuiTool(humanTools.observe, {
                scope: 'screen',
                return_image: true,
            })
            : visualScreenshot
                ? () => callMcpGuiTool(visualScreenshot, {
                    scope: 'foreground_window',
                    return_image: true,
                })
                : windowsScreenshot
                    ? () => callMcpGuiTool(windowsScreenshot, {
                        use_annotation: false,
                    })
                    : undefined,
    };
}
function summarizeGuiBackendSources(connections) {
    return connections.map(connection => {
        const toolNames = new Set(connection.tools.map(tool => tool.name.toLowerCase()));
        const humanGuiTools = connection.tools
            .map(tool => tool.name)
            .filter(name => name.toLowerCase().startsWith('human_gui_'))
            .sort((left, right) => left.localeCompare(right));
        return {
            serverName: connection.serverName,
            status: connection.status,
            serverInfo: connection.serverInfo,
            toolCount: connection.tools.length,
            humanGuiTools,
            humanGuiToolCount: humanGuiTools.length,
            hasUia: hasAnyTool(toolNames, ['uia_action', 'windows_action', 'gui_uia_action', 'click', 'type', 'shortcut']),
            hasVisual: humanGuiTools.length > 0 || hasAnyTool(toolNames, ['visual_action_with_wait', 'visual_action']),
            hasScreenshot: hasAnyTool(toolNames, ['human_gui_observe', 'visual_screenshot', 'screenshot', 'snapshot']),
            error: connection.error,
        };
    });
}
function diagnoseDingxuHumanGui(sources) {
    const source = preferredDingxuSource(sources);
    if (!source) {
        return {
            ok: false,
            toolCount: 0,
            humanGuiToolCount: 0,
            missingTools: REQUIRED_DINGXU_HUMAN_GUI_TOOLS,
            message: 'No Dingxu-compatible human GUI MCP source is connected.',
        };
    }
    const available = new Set(source.humanGuiTools.map(tool => tool.toLowerCase()));
    const missingTools = REQUIRED_DINGXU_HUMAN_GUI_TOOLS.filter(tool => !available.has(tool));
    const ok = source.status === 'connected' && missingTools.length === 0;
    return {
        ok,
        source: source.serverName,
        serverName: source.serverInfo?.name,
        serverVersion: source.serverInfo?.version,
        toolCount: source.toolCount,
        humanGuiToolCount: source.humanGuiToolCount,
        missingTools,
        message: ok
            ? 'Dingxu-compatible human GUI toolset is complete.'
            : source.status !== 'connected'
                ? `Dingxu-compatible source is ${source.status}${source.error ? `: ${source.error}` : '.'}`
                : `Dingxu-compatible source is missing ${missingTools.length} required tool(s).`,
    };
}
function preferredDingxuSource(sources) {
    return sources.find(source => source.serverInfo?.name === 'Dingxu Human GUI')
        ?? sources.find(source => source.serverName.toLowerCase().includes('dingxu'))
        ?? sources.find(source => source.humanGuiToolCount > 0);
}
function guiCapabilities(methods, sources) {
    const capabilities = [];
    if (methods.uia)
        capabilities.push('uia');
    if (methods.visual)
        capabilities.push('visual');
    if (methods.screenshot)
        capabilities.push('screenshot');
    if (sources.some(source => source.humanGuiToolCount > 0)) {
        capabilities.push('dingxu_human_gui');
        capabilities.push('observe_click_type_keys_draw_wait_release');
        if (sources.some(source => source.humanGuiToolCount >= 20)) {
            capabilities.push('advanced_grid_reflex_multi_stroke');
        }
    }
    return capabilities;
}
function hasAnyTool(toolNames, names) {
    return names.some(name => toolNames.has(name.toLowerCase()));
}
async function withVerification(request, backend, result) {
    if (!request.verify || !backend.screenshot)
        return result;
    const verification = await backend.screenshot(request);
    if (!verification.ok) {
        return {
            ...result,
            ok: false,
            message: verification.message ?? 'GUI screenshot verification failed.',
            screenshotPath: verification.screenshotPath ?? result.screenshotPath,
            failureClass: verification.failureClass ?? 'verification_failed',
            audit: mergeGuiAudits(result.audit, verification.audit),
        };
    }
    return {
        ...result,
        screenshotPath: verification.screenshotPath ?? result.screenshotPath,
        audit: mergeGuiAudits(result.audit, verification.audit),
    };
}
function toGuiResult(method, result, fallbackUsed) {
    return {
        ok: result.ok,
        method,
        message: result.message ?? `${method} action completed.`,
        screenshotPath: result.screenshotPath,
        fallbackUsed,
        failureClass: result.failureClass,
        audit: result.audit,
    };
}
function findMcpTool(connections, names) {
    const normalizedNames = new Set(names.map(name => name.toLowerCase()));
    for (const connection of connections) {
        if (connection.status !== 'connected' || !connection.client)
            continue;
        const tool = connection.tools.find(item => normalizedNames.has(item.name.toLowerCase()));
        if (!tool)
            continue;
        return {
            name: tool.name,
            async call(input) {
                return connection.client?.callTool(tool.name, input);
            },
        };
    }
    return undefined;
}
async function callHumanGuiTool(tool, input) {
    const result = await callMcpGuiTool(tool, input);
    return {
        ...result,
        method: 'human_gui',
    };
}
async function callMcpGuiTool(tool, input) {
    try {
        return normalizeMcpGuiResult(await tool.call(input));
    }
    catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            failureClass: `mcp_${tool.name.toLowerCase()}_failed`,
        };
    }
}
function createHumanGuiToolSet(connections) {
    const tools = {
        observe: findMcpTool(connections, ['human_gui_observe']),
        markPoint: findMcpTool(connections, ['human_gui_mark_point']),
        confirmPoint: findMcpTool(connections, ['human_gui_confirm_point']),
        analyzeGrid: findMcpTool(connections, ['human_gui_analyze_grid']),
        fastClick: findMcpTool(connections, ['human_gui_fast_click']),
        reflexClick: findMcpTool(connections, ['human_gui_reflex_click']),
        executeClick: findMcpTool(connections, ['human_gui_execute_click']),
        executeMouse: findMcpTool(connections, ['human_gui_execute_mouse']),
        drawPath: findMcpTool(connections, ['human_gui_draw_path']),
        drawPaths: findMcpTool(connections, ['human_gui_draw_paths']),
        executeKeys: findMcpTool(connections, ['human_gui_execute_keys']),
        setKeyState: findMcpTool(connections, ['human_gui_set_key_state']),
        setMouseButtonState: findMcpTool(connections, ['human_gui_set_mouse_button_state']),
        typeText: findMcpTool(connections, ['human_gui_type_text']),
        wait: findMcpTool(connections, ['human_gui_wait']),
        waitForChange: findMcpTool(connections, ['human_gui_wait_for_change']),
        waitUntilStable: findMcpTool(connections, ['human_gui_wait_until_stable']),
        compareObservations: findMcpTool(connections, ['human_gui_compare_observations']),
        releaseAll: findMcpTool(connections, ['human_gui_release_all']),
        runSequence: findMcpTool(connections, ['human_gui_run_sequence']),
    };
    return Object.values(tools).some(Boolean) ? tools : undefined;
}
function createWindowsMcpToolSet(connections) {
    const tools = {
        app: findMcpTool(connections, ['App']),
        click: findMcpTool(connections, ['Click']),
        type: findMcpTool(connections, ['Type']),
        shortcut: findMcpTool(connections, ['Shortcut']),
        scroll: findMcpTool(connections, ['Scroll']),
        move: findMcpTool(connections, ['Move']),
        wait: findMcpTool(connections, ['Wait']),
        screenshot: findMcpTool(connections, ['Screenshot', 'Snapshot']),
    };
    return Object.values(tools).some(Boolean) ? tools : undefined;
}
async function runWindowsMcpAction(request, tools) {
    const action = normalizeActionName(request.action);
    const target = windowsTarget(request);
    if (action === 'click') {
        if (!tools.click)
            return unavailable('Click');
        return callMcpGuiTool(tools.click, {
            ...target,
            button: request.button ?? 'left',
            clicks: request.clicks ?? 1,
        });
    }
    if (action === 'type' || action === 'type_text' || action === 'paste_text') {
        if (!tools.type)
            return unavailable('Type');
        if (!request.text)
            return failed('text is required for GUI text input', 'missing_text');
        return callMcpGuiTool(tools.type, {
            text: request.text,
            ...target,
            clear: request.clear ?? false,
            press_enter: request.pressEnter ?? false,
        });
    }
    if (action === 'hotkey' || action === 'shortcut' || action === 'key_press' || action === 'press_key') {
        if (!tools.shortcut)
            return unavailable('Shortcut');
        const shortcut = request.keys?.length ? request.keys.join('+') : request.target;
        if (!shortcut)
            return failed('keys or target is required for GUI shortcut input', 'missing_keys');
        return callMcpGuiTool(tools.shortcut, { shortcut });
    }
    if (action === 'scroll') {
        if (!tools.scroll)
            return unavailable('Scroll');
        return callMcpGuiTool(tools.scroll, {
            ...target,
            direction: request.direction ?? (Number(request.wheelTimes ?? 0) < 0 ? 'down' : 'up'),
            wheel_times: Math.abs(request.wheelTimes ?? 1),
        });
    }
    if (action === 'move' || action === 'drag') {
        if (!tools.move)
            return unavailable('Move');
        return callMcpGuiTool(tools.move, {
            ...target,
            drag: action === 'drag',
        });
    }
    if (action === 'wait') {
        if (!tools.wait)
            return unavailable('Wait');
        return callMcpGuiTool(tools.wait, {
            duration: Math.max(1, Math.round((request.timeoutMs ?? 1000) / 1000)),
        });
    }
    if (action === 'focus' || action === 'switch' || action === 'launch') {
        if (!tools.app)
            return unavailable('App');
        return callMcpGuiTool(tools.app, {
            mode: action === 'launch' ? 'launch' : 'switch',
            name: request.target,
        });
    }
    if (action === 'screenshot') {
        const screenshot = tools.screenshot;
        if (!screenshot)
            return unavailable('Screenshot');
        return callMcpGuiTool(screenshot, {
            use_annotation: false,
        });
    }
    return failed(`Unsupported Windows GUI action: ${request.action}`, 'unsupported_action');
}
async function runHumanGuiAction(request, tools) {
    const action = normalizeActionName(request.action);
    if (action === 'observe' || action === 'screenshot') {
        if (!tools.observe)
            return unavailable('human_gui_observe');
        return callHumanGuiTool(tools.observe, {
            scope: 'screen',
            markCursor: false,
            return_image: true,
        });
    }
    if (action === 'release_all' || action === 'releaseall') {
        if (!tools.releaseAll)
            return unavailable('human_gui_release_all');
        return callHumanGuiTool(tools.releaseAll, {
            waitMs: waitMs(request, 100),
            return_image: true,
        });
    }
    if (action === 'wait') {
        if (!tools.wait)
            return unavailable('human_gui_wait');
        return callHumanGuiTool(tools.wait, {
            waitMs: waitMs(request, 1000),
            expectedChange: expectedChange(request),
            return_image: true,
        });
    }
    if (action === 'wait_for_change' || action === 'waituntilchange') {
        if (!tools.waitForChange)
            return unavailable('human_gui_wait_for_change');
        const observationId = await currentObservationId(tools);
        if (!observationId)
            return failed('human_gui_observe did not return observationId.', 'observe_failed');
        return callHumanGuiTool(tools.waitForChange, {
            observationId,
            timeoutMs: waitMs(request, 5000),
            return_image: true,
        });
    }
    if (action === 'wait_until_stable' || action === 'stable') {
        if (!tools.waitUntilStable)
            return unavailable('human_gui_wait_until_stable');
        return callHumanGuiTool(tools.waitUntilStable, {
            timeoutMs: waitMs(request, 5000),
            return_image: true,
        });
    }
    if (action === 'analyze_grid' || action === 'grid') {
        if (!tools.analyzeGrid)
            return unavailable('human_gui_analyze_grid');
        const region = normalizedRegion(request.region);
        if (!region)
            return failed('region is required for Dingxu human GUI grid analysis.', 'missing_region');
        const observationId = request.observationId ?? await currentObservationId(tools);
        if (!observationId)
            return failed('human_gui_observe did not return observationId.', 'observe_failed');
        return callHumanGuiTool(tools.analyzeGrid, {
            observationId,
            region,
            targetColor: request.targetColor ?? 'red',
            selectedColor: request.selectedColor ?? 'blue_overlay',
            lineColor: request.lineColor ?? 'light',
            includeAnnotatedImage: true,
            return_image: true,
        });
    }
    if (action === 'reflex_click' || action === 'reflex') {
        if (!tools.reflexClick)
            return unavailable('human_gui_reflex_click');
        const region = normalizedRegion(request.region);
        if (!region)
            return failed('region is required for Dingxu human GUI reflex click.', 'missing_region');
        return callHumanGuiTool(tools.reflexClick, {
            region,
            targetColor: request.targetColor ?? 'brown',
            selectedColor: request.selectedColor ?? 'blue_overlay',
            lineColor: request.lineColor ?? 'light',
            durationMs: Math.max(1, Math.round(request.durationMs ?? request.timeoutMs ?? 3000)),
            maxClicks: Math.max(1, Math.round(request.maxClicks ?? 20)),
            button: request.button ?? 'left',
            clickCount: Math.max(1, Math.min(3, Math.round(request.clicks ?? 1))),
            waitMs: waitMs(request, 150),
            return_image: true,
        });
    }
    if (action === 'fast_click' || action === 'quick_click') {
        if (!tools.fastClick)
            return unavailable('human_gui_fast_click');
        const point = actionPoint(request);
        if (!point)
            return failed('x and y are required for Dingxu human GUI fast click.', 'missing_coordinates');
        const observationId = request.observationId ?? await currentObservationId(tools);
        if (!observationId)
            return failed('human_gui_observe did not return observationId.', 'observe_failed');
        return callHumanGuiTool(tools.fastClick, {
            observationId,
            x: Math.round(point.x),
            y: Math.round(point.y),
            confidence: clamp01(request.confidence ?? 0.95),
            minConfidence: clamp01(request.minConfidence ?? 0.85),
            reason: 'Pando fast click from explicit agent coordinates.',
            button: request.button ?? 'left',
            clickCount: Math.max(1, Math.min(3, Math.round(request.clicks ?? 1))),
            waitMs: waitMs(request, 150),
            expectedChange: expectedChange(request),
        });
    }
    if (action === 'compare_observations' || action === 'compare') {
        if (!tools.compareObservations)
            return unavailable('human_gui_compare_observations');
        if (!request.beforeObservationId || !request.afterObservationId) {
            return failed('beforeObservationId and afterObservationId are required for observation comparison.', 'missing_observation_ids');
        }
        return callHumanGuiTool(tools.compareObservations, {
            beforeObservationId: request.beforeObservationId,
            afterObservationId: request.afterObservationId,
            expectedChange: expectedChange(request),
            return_image: true,
        });
    }
    if (action === 'click' || action === 'mouse_click') {
        const point = actionPoint(request);
        if (!point)
            return failed('x and y are required for Dingxu human GUI click fallback.', 'missing_coordinates');
        return runHumanGuiSequence(tools, [
            observeStep(),
            markStep(point, 'Pando explicit click target.'),
            confirmStep(),
            {
                id: 'action',
                tool: 'human_gui_execute_click',
                arguments: {
                    confirmationId: '${confirm.confirmationId}',
                    button: request.button ?? 'left',
                    clickCount: Math.max(1, Math.min(3, Math.round(request.clicks ?? 1))),
                    waitMs: waitMs(request, 300),
                    expectedChange: expectedChange(request),
                },
            },
        ], releaseGuard());
    }
    if (action === 'type' || action === 'type_text' || action === 'paste_text') {
        if (!request.text)
            return failed('text is required for Dingxu human GUI text input.', 'missing_text');
        const point = actionPoint(request);
        const textArgs = {
            observationId: '${observe.observationId}',
            text: request.text,
            waitMs: waitMs(request, 300),
            expectedChange: expectedChange(request),
            unicodeFallback: true,
            forceUnicode: request.forceUnicode ?? false,
        };
        const steps = point
            ? [
                observeStep(),
                markStep(point, 'Pando explicit typing focus target.'),
                confirmStep(),
                {
                    id: 'action',
                    tool: 'human_gui_type_text',
                    arguments: {
                        ...textArgs,
                        confirmationId: '${confirm.confirmationId}',
                        requireConfirmedTarget: true,
                        focusBeforeTyping: true,
                    },
                },
            ]
            : [
                observeStep(),
                {
                    id: 'action',
                    tool: 'human_gui_type_text',
                    arguments: {
                        ...textArgs,
                        requireConfirmedTarget: false,
                        focusBeforeTyping: false,
                    },
                },
            ];
        return runHumanGuiSequence(tools, steps, releaseGuard());
    }
    if (action === 'set_key_state' || action === 'key_state' || action === 'hold_key' || action === 'release_key') {
        if (!tools.setKeyState)
            return unavailable('human_gui_set_key_state');
        const keys = request.keys?.length ? [...request.keys] : request.target ? [request.target] : [];
        if (!keys.length)
            return failed('keys or target is required for Dingxu human GUI key state input.', 'missing_keys');
        const state = action === 'release_key' ? 'up' : action === 'hold_key' ? 'down' : request.state;
        if (state !== 'down' && state !== 'up')
            return failed('state must be down or up for key state input.', 'missing_state');
        const point = actionPoint(request);
        const keyArgs = {
            observationId: '${observe.observationId}',
            keys,
            state,
            waitMs: waitMs(request, 100),
            expectedChange: expectedChange(request),
        };
        const steps = state === 'down' && point
            ? [
                observeStep(),
                markStep(point, 'Pando explicit key hold focus target.'),
                confirmStep(),
                {
                    id: 'action',
                    tool: 'human_gui_set_key_state',
                    arguments: {
                        ...keyArgs,
                        confirmationId: '${confirm.confirmationId}',
                        requireConfirmedTarget: true,
                        focusBeforeKeys: true,
                    },
                },
            ]
            : [
                observeStep(),
                {
                    id: 'action',
                    tool: 'human_gui_set_key_state',
                    arguments: {
                        ...keyArgs,
                        requireConfirmedTarget: false,
                        focusBeforeKeys: false,
                    },
                },
            ];
        return runHumanGuiSequence(tools, steps, { releaseBefore: true, releaseAfter: state === 'up' });
    }
    if (action === 'hotkey' || action === 'shortcut' || action === 'key_press' || action === 'press_key' || action === 'press_enter') {
        const keys = action === 'press_enter' ? ['Enter'] : request.keys?.length ? [...request.keys] : request.target ? [request.target] : [];
        if (!keys.length)
            return failed('keys or target is required for Dingxu human GUI key input.', 'missing_keys');
        const point = actionPoint(request);
        const keyArgs = {
            observationId: '${observe.observationId}',
            keys,
            waitMs: waitMs(request, 300),
            expectedChange: expectedChange(request),
        };
        const steps = point
            ? [
                observeStep(),
                markStep(point, 'Pando explicit keyboard focus target.'),
                confirmStep(),
                {
                    id: 'action',
                    tool: 'human_gui_execute_keys',
                    arguments: {
                        ...keyArgs,
                        confirmationId: '${confirm.confirmationId}',
                        requireConfirmedTarget: true,
                        focusBeforeKeys: true,
                    },
                },
            ]
            : [
                observeStep(),
                {
                    id: 'action',
                    tool: 'human_gui_execute_keys',
                    arguments: {
                        ...keyArgs,
                        requireConfirmedTarget: false,
                        focusBeforeKeys: false,
                    },
                },
            ];
        return runHumanGuiSequence(tools, steps, releaseGuard());
    }
    if (action === 'set_mouse_button_state' || action === 'mouse_button_state' || action === 'mouse_down' || action === 'mouse_up') {
        if (!tools.setMouseButtonState)
            return unavailable('human_gui_set_mouse_button_state');
        const state = action === 'mouse_up' ? 'up' : action === 'mouse_down' ? 'down' : request.state;
        if (state !== 'down' && state !== 'up')
            return failed('state must be down or up for mouse button state input.', 'missing_state');
        const point = actionPoint(request);
        if (state === 'down' && !point)
            return failed('x and y are required for Dingxu human GUI mouse down.', 'missing_coordinates');
        if (state === 'up') {
            return callHumanGuiTool(tools.setMouseButtonState, {
                button: request.button ?? 'left',
                state,
                waitMs: waitMs(request, 100),
                expectedChange: expectedChange(request),
                return_image: true,
            });
        }
        return runHumanGuiSequence(tools, [
            observeStep(),
            markStep(point, 'Pando explicit mouse button down target.'),
            confirmStep(),
            {
                id: 'action',
                tool: 'human_gui_set_mouse_button_state',
                arguments: {
                    confirmationId: '${confirm.confirmationId}',
                    button: request.button ?? 'left',
                    state,
                    waitMs: waitMs(request, 100),
                    expectedChange: expectedChange(request),
                },
            },
        ], { releaseBefore: true });
    }
    if (action === 'scroll' || action === 'move') {
        const point = actionPoint(request);
        if (!point)
            return failed(`x and y are required for Dingxu human GUI ${action} fallback.`, 'missing_coordinates');
        return runHumanGuiSequence(tools, [
            observeStep(),
            markStep(point, `Pando explicit ${action} target.`),
            confirmStep(),
            {
                id: 'action',
                tool: 'human_gui_execute_mouse',
                arguments: {
                    action,
                    confirmationId: '${confirm.confirmationId}',
                    wheelClicks: action === 'scroll' ? wheelClicks(request) : undefined,
                    scrollAxis: scrollAxis(request),
                    waitMs: waitMs(request, 300),
                    expectedChange: expectedChange(request),
                },
            },
        ], releaseGuard());
    }
    if (action === 'draw_paths' || (action === 'draw' && normalizedStrokes(request.strokes).length > 0)) {
        if (!tools.drawPaths)
            return unavailable('human_gui_draw_paths');
        const strokes = normalizedStrokes(request.strokes);
        if (!strokes.length)
            return failed('strokes with at least one two-point stroke are required for Dingxu human GUI draw_paths.', 'missing_strokes');
        const steps = [observeStep()];
        strokes.forEach((stroke, index) => {
            steps.push(markStepWithId(`mark_${index}`, stroke[0], `Pando explicit draw_paths stroke ${index + 1} start.`));
            steps.push(confirmStepWithId(`confirm_${index}`, `\${mark_${index}.markId}`));
        });
        steps.push({
            id: 'action',
            tool: 'human_gui_draw_paths',
            arguments: {
                observationId: '${observe.observationId}',
                strokeStartConfirmationIds: strokes.map((_, index) => `\${confirm_${index}.confirmationId}`),
                strokes: strokes.map(points => ({ points })),
                waitMs: waitMs(request, 300),
                expectedChange: expectedChange(request),
            },
        });
        return runHumanGuiSequence(tools, steps, releaseGuard());
    }
    if (action === 'draw' || action === 'draw_path') {
        const points = normalizedPoints(request.points);
        if (points.length < 2)
            return failed('points with at least two coordinates are required for Dingxu human GUI draw_path.', 'missing_points');
        return runHumanGuiSequence(tools, [
            observeStep(),
            markStep(points[0], 'Pando explicit draw path start.'),
            confirmStep(),
            {
                id: 'action',
                tool: 'human_gui_draw_path',
                arguments: {
                    observationId: '${observe.observationId}',
                    confirmationId: '${confirm.confirmationId}',
                    points,
                    waitMs: waitMs(request, 300),
                    expectedChange: expectedChange(request),
                },
            },
        ], releaseGuard());
    }
    return failed(`Unsupported Dingxu human GUI action: ${request.action}`, 'unsupported_action');
}
async function currentObservationId(tools) {
    if (!tools.observe)
        return undefined;
    const result = await tools.observe.call({
        scope: 'screen',
        return_image: false,
    });
    const normalized = normalizeMcpGuiResult(result);
    if (!normalized.ok)
        return undefined;
    return observationIdFromUnknown(result);
}
async function runHumanGuiSequence(tools, steps, options = {}) {
    if (!tools.runSequence)
        return unavailable('human_gui_run_sequence');
    return callHumanGuiTool(tools.runSequence, {
        steps: guardedSequenceSteps(tools, steps, options),
        stopOnError: true,
        releaseOnError: true,
    });
}
function releaseGuard() {
    return {
        releaseBefore: true,
        releaseAfter: true,
    };
}
function guardedSequenceSteps(tools, steps, options) {
    const guarded = [...steps];
    if (options.releaseBefore && tools.releaseAll) {
        guarded.unshift(releaseStep('release_before'));
    }
    if (options.releaseAfter && tools.releaseAll) {
        guarded.push(releaseStep('release_after'));
    }
    return guarded;
}
function releaseStep(id) {
    return {
        id,
        tool: 'human_gui_release_all',
        arguments: {
            waitMs: 50,
            return_image: false,
        },
    };
}
function observeStep() {
    return {
        id: 'observe',
        tool: 'human_gui_observe',
        arguments: {
            scope: 'screen',
            return_image: false,
        },
    };
}
function markStep(point, reason) {
    return markStepWithId('mark', point, reason);
}
function markStepWithId(id, point, reason) {
    return {
        id,
        tool: 'human_gui_mark_point',
        arguments: {
            observationId: '${observe.observationId}',
            x: Math.round(point.x),
            y: Math.round(point.y),
            reason,
        },
    };
}
function confirmStep() {
    return confirmStepWithId('confirm', '${mark.markId}');
}
function confirmStepWithId(id, markId) {
    return {
        id,
        tool: 'human_gui_confirm_point',
        arguments: {
            markId,
            status: 'confirmed',
            confidence: 0.95,
            reason: 'Pando received explicit coordinates from the agent request.',
        },
    };
}
async function runVisualMcpAction(request, tool) {
    const action = normalizeActionName(request.action);
    const mappedAction = toVisualAction(request, action);
    if (!('action' in mappedAction))
        return mappedAction;
    return callMcpGuiTool(tool, {
        action: mappedAction.action,
        observe_scope: 'foreground_window',
        timeout_seconds: request.timeoutMs ? Math.max(0, request.timeoutMs / 1000) : undefined,
        return_image: true,
    });
}
function toVisualAction(request, action) {
    if (action === 'click') {
        if (typeof request.x !== 'number' || typeof request.y !== 'number') {
            return failed('x and y are required for visual click fallback.', 'missing_coordinates');
        }
        return {
            ok: true,
            action: {
                type: 'click',
                x: Math.round(request.x),
                y: Math.round(request.y),
                coordinate_space: request.coordinateSpace ?? 'screen',
                button: request.button ?? 'left',
                clicks: request.clicks ?? 1,
            },
        };
    }
    if (action === 'type' || action === 'type_text' || action === 'paste_text') {
        if (!request.text)
            return failed('text is required for visual text input.', 'missing_text');
        return {
            ok: true,
            action: {
                type: 'paste_text',
                text: request.text,
                press_enter: request.pressEnter ?? false,
            },
        };
    }
    if (action === 'hotkey' || action === 'shortcut') {
        if (!request.keys?.length)
            return failed('keys are required for visual hotkey input.', 'missing_keys');
        return {
            ok: true,
            action: {
                type: 'hotkey',
                keys: request.keys,
            },
        };
    }
    if (action === 'key_press' || action === 'press_key') {
        const key = request.keys?.[0] ?? request.target;
        if (!key)
            return failed('key is required for visual key press input.', 'missing_key');
        return {
            ok: true,
            action: {
                type: 'key_press',
                key,
            },
        };
    }
    if (action === 'press_enter') {
        return {
            ok: true,
            action: {
                type: 'press_enter',
            },
        };
    }
    if (action === 'mouse_click') {
        return {
            ok: true,
            action: {
                type: 'mouse_click',
                button: request.button ?? 'left',
                clicks: request.clicks ?? 1,
            },
        };
    }
    if (action === 'scroll') {
        return {
            ok: true,
            action: {
                type: 'scroll',
                wheel_times: request.wheelTimes ?? 1,
            },
        };
    }
    return failed(`Unsupported visual GUI action: ${request.action}`, 'unsupported_action');
}
function actionPoint(request) {
    if (typeof request.x === 'number' && typeof request.y === 'number') {
        return { x: request.x, y: request.y };
    }
    if (!request.target)
        return undefined;
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(request.target);
    if (!match)
        return undefined;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
    };
}
function normalizedPoints(points) {
    if (!points)
        return [];
    return points.flatMap(point => (typeof point?.x === 'number' && typeof point.y === 'number'
        ? [{ x: Math.round(point.x), y: Math.round(point.y) }]
        : []));
}
function normalizedStrokes(strokes) {
    if (!strokes)
        return [];
    return strokes
        .map(stroke => normalizedPoints(stroke))
        .filter(stroke => stroke.length >= 2);
}
function normalizedRegion(region) {
    if (!region || typeof region.left !== 'number' || typeof region.top !== 'number')
        return undefined;
    const out = {
        left: Math.round(region.left),
        top: Math.round(region.top),
    };
    if (typeof region.right === 'number')
        out.right = Math.round(region.right);
    if (typeof region.bottom === 'number')
        out.bottom = Math.round(region.bottom);
    if (typeof region.width === 'number')
        out.width = Math.round(region.width);
    if (typeof region.height === 'number')
        out.height = Math.round(region.height);
    return out;
}
function waitMs(request, fallback) {
    return Math.max(0, Math.round(request.timeoutMs ?? fallback));
}
function expectedChange(request) {
    if (request.verify === true)
        return 'required';
    if (request.verify === 'none')
        return 'none';
    if (request.verify === 'required')
        return 'required';
    if (request.verify === 'unknown')
        return 'unknown';
    return 'optional';
}
function wheelClicks(request) {
    const times = Math.max(1, Math.abs(Math.round(request.wheelTimes ?? 1)));
    return request.direction === 'down' || request.direction === 'right' ? -times : times;
}
function scrollAxis(request) {
    return request.direction === 'left' || request.direction === 'right' ? 'horizontal' : 'vertical';
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function windowsTarget(request) {
    if (typeof request.x === 'number' && typeof request.y === 'number')
        return { loc: [Math.round(request.x), Math.round(request.y)] };
    if (!request.target)
        return {};
    const numeric = Number(request.target);
    return Number.isInteger(numeric) ? { label: numeric } : { loc: request.target };
}
function normalizeActionName(action) {
    return action.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}
function shouldSkipUia(action) {
    const normalized = normalizeActionName(action);
    return [
        'release_all',
        'releaseall',
        'draw',
        'draw_path',
        'draw_paths',
        'analyze_grid',
        'grid',
        'fast_click',
        'quick_click',
        'reflex_click',
        'reflex',
        'compare_observations',
        'compare',
        'set_key_state',
        'key_state',
        'hold_key',
        'release_key',
        'set_mouse_button_state',
        'mouse_button_state',
        'mouse_down',
        'mouse_up',
    ].includes(normalized);
}
function unavailable(toolName) {
    return failed(`${toolName} MCP tool is not available.`, 'backend_tool_missing');
}
function failed(message, failureClass) {
    return {
        ok: false,
        message,
        failureClass,
    };
}
function normalizeMcpGuiResult(result) {
    if (isRecord(result)) {
        if (typeof result.ok === 'boolean') {
            return {
                ok: result.ok,
                message: typeof result.message === 'string' ? result.message : undefined,
                screenshotPath: screenshotPathFromRecord(result),
                failureClass: typeof result.failureClass === 'string' ? result.failureClass : undefined,
                audit: auditFromRecord(result),
            };
        }
        const content = result.content;
        if (Array.isArray(content)) {
            const text = content
                .map(item => (isRecord(item) && typeof item.text === 'string' ? item.text : undefined))
                .filter((item) => Boolean(item))
                .join('\n');
            if (text) {
                const parsed = parseJsonObject(text);
                if (parsed)
                    return normalizeMcpGuiResult(parsed);
                return { ok: true, message: text };
            }
        }
        return {
            ok: true,
            message: typeof result.message === 'string' ? result.message : JSON.stringify(result),
            screenshotPath: screenshotPathFromRecord(result),
            audit: auditFromRecord(result),
        };
    }
    return {
        ok: true,
        message: typeof result === 'string' ? result : JSON.stringify(result),
    };
}
function screenshotPathFromRecord(record) {
    for (const key of [
        'screenshotPath',
        'screenshot_path',
        'imagePath',
        'image_path',
        'path',
        'afterImagePath',
        'after_image_path',
        'markedImagePath',
        'marked_image_path',
        'sourceImagePath',
        'annotatedImagePath',
        'diffImagePath',
    ]) {
        const value = record[key];
        if (typeof value === 'string')
            return value;
    }
    const failureEvidence = record.failureEvidence;
    if (isRecord(failureEvidence)) {
        const nested = screenshotPathFromRecord(failureEvidence);
        if (nested)
            return nested;
    }
    const result = record.result;
    if (isRecord(result)) {
        const nested = screenshotPathFromRecord(result);
        if (nested)
            return nested;
    }
    const results = record.results;
    if (Array.isArray(results)) {
        for (const item of [...results].reverse()) {
            if (!isRecord(item))
                continue;
            const nested = screenshotPathFromRecord(item);
            if (nested)
                return nested;
        }
    }
    const after = record.after;
    if (isRecord(after))
        return screenshotPathFromRecord(after);
    return undefined;
}
function auditFromRecord(record) {
    const own = {};
    copyString(record, own, 'tool');
    copyString(record, own, 'sequenceId');
    copyString(record, own, 'actionId');
    copyString(record, own, 'observationId');
    copyString(record, own, 'beforeObservationId');
    copyString(record, own, 'afterObservationId');
    copyString(record, own, 'markId');
    copyString(record, own, 'confirmationId');
    copyString(record, own, 'sourceImagePath');
    copyString(record, own, 'markedImagePath');
    copyString(record, own, 'afterImagePath');
    copyString(record, own, 'annotatedImagePath');
    copyString(record, own, 'diffImagePath');
    copyNumber(record, own, 'attemptedStepCount');
    copyNumber(record, own, 'completedStepCount');
    copyUnknown(record, own, 'toolDiscipline');
    copyUnknown(record, own, 'focusDiscipline');
    copyUnknown(record, own, 'visualReview');
    copyUnknown(record, own, 'postActionVerification');
    copyUnknown(record, own, 'failureEvidence');
    if (isRecord(record.failureEvidence)) {
        const evidencePath = screenshotPathFromRecord(record.failureEvidence);
        if (evidencePath)
            own.failureEvidencePath = evidencePath;
    }
    let audit = Object.keys(own).length ? own : undefined;
    const result = record.result;
    if (isRecord(result))
        audit = mergeGuiAudits(audit, auditFromRecord(result));
    const after = record.after;
    if (isRecord(after))
        audit = mergeGuiAudits(audit, auditFromRecord(after));
    const results = record.results;
    if (Array.isArray(results)) {
        const records = results.filter(isRecord);
        const nonActionRecords = records.filter(item => item.id !== 'action');
        const actionRecords = records.filter(item => item.id === 'action');
        for (const item of [...nonActionRecords, ...actionRecords]) {
            if (!isRecord(item))
                continue;
            audit = mergeGuiAudits(audit, auditFromRecord(item));
        }
    }
    return audit;
}
function mergeGuiAudits(left, right) {
    if (!left)
        return right;
    if (!right)
        return left;
    return {
        ...left,
        ...right,
        toolDiscipline: right.toolDiscipline ?? left.toolDiscipline,
        focusDiscipline: right.focusDiscipline ?? left.focusDiscipline,
        visualReview: right.visualReview ?? left.visualReview,
        postActionVerification: right.postActionVerification ?? left.postActionVerification,
        failureEvidence: right.failureEvidence ?? left.failureEvidence,
    };
}
function copyString(source, target, key) {
    const value = source[key];
    if (typeof value === 'string')
        target[key] = value;
}
function copyNumber(source, target, key) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value))
        target[key] = value;
}
function copyUnknown(source, target, key) {
    if (source[key] !== undefined)
        target[key] = source[key];
}
function observationIdFromUnknown(value) {
    if (!isRecord(value))
        return undefined;
    const direct = value.observationId;
    if (typeof direct === 'string')
        return direct;
    const content = value.content;
    if (Array.isArray(content)) {
        for (const item of content) {
            if (!isRecord(item) || typeof item.text !== 'string')
                continue;
            const parsed = parseJsonObject(item.text);
            const nested = observationIdFromUnknown(parsed);
            if (nested)
                return nested;
        }
    }
    return undefined;
}
function parseJsonObject(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
