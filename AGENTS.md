<INSTRUCTIONS>
1. 如无必要，勿增实体。
2. 实事求是，不会就不做，不要做错。
3. 默认使用英文/ASCII 命名文件、目录、程序标识、配置键和脚本路径；不要新建中文路径。只有确实需要中文语义的内容才使用中文，例如提示词、识别文本、展示文案和用户明确要求的中文内容。
Behavioral guidelines to reduce common LLM coding mistakes.
Merge with project-specific instructions as needed.
**Tradeoff:** These guidelines bias toward caution over speed.
For trivial tasks, use judgment.

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite.
Ask yourself: "Would a senior engineer say this is overcomplicated?"
If yes, simplify.

## 3. Surgical Changes
**Touch only what must. Clean up only your own mess.**
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing project style even if you disagree.
- If dead code or bugs are spotted, mention them — do not delete or fix unprompted.

## 4. Goal-Driven Execution
**Define clear success criteria before writing code. Verify completion.**
- Start by writing testable acceptance criteria for the task.
- Do not consider the task done until the criteria pass.
- If tests fail, iterate incrementally instead of rewriting large blocks.
- At completion, summarize exactly what changed and confirm it meets all original requirements.

</INSTRUCTIONS>
