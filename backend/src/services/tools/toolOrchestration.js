import { all } from '../../utils/generators.js';
import { getNumericEnv } from '../../utils/env.js';
import { runToolUse } from './toolExecution.js';
export async function* runTools(toolUses, registry, context) {
    let currentContext = context;
    for (const batch of partitionToolCalls(toolUses, registry, currentContext)) {
        if (batch.isConcurrencySafe) {
            const queuedModifiers = new Map();
            for await (const update of runToolsConcurrently(batch.toolUses, registry, currentContext)) {
                const toolUseId = update.result.toolUseId;
                if (update.contextModifier) {
                    const modifiers = queuedModifiers.get(toolUseId) ?? [];
                    modifiers.push(update.contextModifier);
                    queuedModifiers.set(toolUseId, modifiers);
                }
                yield update;
            }
            for (const toolUse of batch.toolUses) {
                for (const modifier of queuedModifiers.get(toolUse.id) ?? []) {
                    currentContext = modifier(currentContext);
                }
            }
        }
        else {
            for await (const update of runToolsSerially(batch.toolUses, registry, currentContext)) {
                if (update.contextModifier) {
                    currentContext = update.contextModifier(currentContext);
                }
                yield update;
            }
        }
    }
}
export function partitionToolCalls(toolUses, registry, context) {
    const batches = [];
    for (const toolUse of toolUses) {
        const tool = registry.get(toolUse.name);
        const isConcurrencySafe = Boolean(tool &&
            (tool.isConcurrencySafe?.(toolUse.input, context) ??
                tool.isReadOnly?.(toolUse.input, context) ??
                tool.safety === 'read_only'));
        const previous = batches[batches.length - 1];
        if (isConcurrencySafe && previous?.isConcurrencySafe) {
            previous.toolUses.push(toolUse);
        }
        else {
            batches.push({ isConcurrencySafe, toolUses: [toolUse] });
        }
    }
    return batches;
}
async function* runToolsSerially(toolUses, registry, context) {
    for (const toolUse of toolUses) {
        markToolInProgress(context, toolUse.id);
        for await (const update of runToolUse(toolUse, registry, context)) {
            context.recordToolResult?.(update.result);
            yield update;
        }
        markToolComplete(context, toolUse.id);
    }
}
async function* runToolsConcurrently(toolUses, registry, context) {
    const runners = toolUses.map(async function* (toolUse) {
        markToolInProgress(context, toolUse.id);
        for await (const update of runToolUse(toolUse, registry, context)) {
            context.recordToolResult?.(update.result);
            yield update;
        }
        markToolComplete(context, toolUse.id);
    });
    yield* all(runners, getMaxToolUseConcurrency());
}
function getMaxToolUseConcurrency() {
    return Math.max(1, getNumericEnv('PANDOSHARE_MAX_TOOL_USE_CONCURRENCY', 10));
}
function markToolInProgress(context, toolUseId) {
    context.inProgressToolUseIds?.add(toolUseId);
    context.markToolInProgress?.(toolUseId);
}
function markToolComplete(context, toolUseId) {
    context.inProgressToolUseIds?.delete(toolUseId);
    context.markToolComplete?.(toolUseId);
}
