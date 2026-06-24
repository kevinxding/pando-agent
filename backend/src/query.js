import { runTools } from './services/tools/toolOrchestration.js';
export async function runQueryTurn(input) {
    if (input.agentSession) {
        const agent = await input.agentSession.runTurn({
            prompt: input.prompt,
            toolRegistry: input.registry,
            toolContext: input.context,
            maxToolRounds: input.maxToolRounds,
            abortSignal: input.context.abortSignal,
        });
        return {
            finalText: agent.finalText,
            toolResults: [...agent.toolResults],
            agent,
        };
    }
    const toolUses = [];
    const toolResults = [];
    for await (const update of runTools(toolUses, input.registry, input.context)) {
        toolResults.push(update.result);
    }
    return {
        finalText: input.prompt,
        toolResults,
    };
}
