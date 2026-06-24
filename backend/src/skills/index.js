import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { resolveWorkspacePath, toPortablePath } from '../tools/shared/index.js';
export class LocalSkillStore {
    context;
    constructor(context) {
        this.context = context;
    }
    async listSkills() {
        const roots = await this.skillRoots();
        const skills = [];
        for (const root of roots) {
            try {
                const entries = await readdir(root.absolutePath);
                for (const entry of entries) {
                    if (!isAsciiId(entry))
                        continue;
                    const skillPath = resolveWorkspacePath(this.context, join(root.relativePath, entry));
                    if (!(await safeIsDirectory(skillPath.absolutePath)))
                        continue;
                    const instructionPath = join(skillPath.absolutePath, 'SKILL.md');
                    skills.push({
                        skillId: entry,
                        name: entry,
                        path: skillPath.relativePath,
                        hasInstructions: await existsFile(instructionPath),
                    });
                }
            }
            catch {
                // Missing skill roots are normal.
            }
        }
        return uniqueBySkillId(skills);
    }
    async loadSkill(skillId, maxChars = 40_000) {
        if (!isAsciiId(skillId))
            throw new Error(`Invalid skillId: ${skillId}`);
        for (const summary of await this.listSkills()) {
            if (summary.skillId !== skillId)
                continue;
            const skillPath = resolveWorkspacePath(this.context, summary.path);
            const instructionPath = join(skillPath.absolutePath, 'SKILL.md');
            const text = await readFile(instructionPath, 'utf8');
            return {
                ...summary,
                instructions: text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]` : text,
            };
        }
        throw new Error(`Skill not found: ${skillId}`);
    }
    async skillRoots() {
        return ['.pandoshare/skills', 'skills']
            .map(path => resolveWorkspacePath(this.context, path))
            .filter(root => basename(root.absolutePath) === 'skills');
    }
}
function uniqueBySkillId(skills) {
    const seen = new Set();
    const output = [];
    for (const skill of skills) {
        if (seen.has(skill.skillId))
            continue;
        seen.add(skill.skillId);
        output.push({
            ...skill,
            path: toPortablePath(skill.path),
        });
    }
    return output.sort((a, b) => a.skillId.localeCompare(b.skillId));
}
async function existsFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
async function safeIsDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    }
    catch {
        return false;
    }
}
function isAsciiId(value) {
    return /^[A-Za-z0-9_-]+$/.test(value);
}
