import { createStructuredErrorResult, createTextResult } from '../../Tool.js';
import { LocalSkillStore } from '../../skills/index.js';
import { optionalPositiveInteger, optionalString, requiredString } from '../shared/index.js';
export const SkillTool = {
    name: 'skill',
    description: 'Discover and load auditable workspace skill packs from .pandoshare/skills or skills.',
    safety: 'read_only',
    platforms: ['all'],
    behavior: { reads: true },
    concurrency: 'safe',
    inputSchema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['list', 'load'] },
            skillId: { type: 'string' },
            maxChars: { type: 'integer', minimum: 1 },
        },
        required: ['action'],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async execute(toolUse, context) {
        try {
            const action = requiredString(toolUse.input, 'action');
            const store = new LocalSkillStore(context);
            if (action === 'list') {
                const skills = await store.listSkills();
                return createTextResult(toolUse.id, JSON.stringify({ skills, count: skills.length }, null, 2), true, { skillCount: skills.length });
            }
            if (action !== 'load')
                throw new Error('action must be list or load');
            const skillId = optionalString(toolUse.input, 'skillId');
            if (!skillId)
                throw new Error('skillId is required for load');
            const data = await store.loadSkill(skillId, optionalPositiveInteger(toolUse.input, 'maxChars', 40_000));
            return createTextResult(toolUse.id, JSON.stringify(data, null, 2), true, { skillId, hasInstructions: data.hasInstructions });
        }
        catch (error) {
            return createStructuredErrorResult(toolUse.id, error, { toolName: 'skill' });
        }
    },
};
