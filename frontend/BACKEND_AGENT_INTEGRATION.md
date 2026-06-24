# PandoShare Client UI Backend Agent Integration Guide

This file explains what each visible UI area/button is supposed to do when the static prototype becomes a real Web App.

Audience: backend Agent developer.

Rule of thumb:
- Backend owns real data, persistence, permissions, Agent execution, tools, tasks, files, model list, and streaming replies.
- Frontend owns visual-only state such as collapsed sidebars, hover actions, panel width, selected tab, dropdown open/close, and local focus.
- Do not use display names as database IDs. Return stable IDs for projects, conversations, messages, files, tasks, plugins, tools, and runs.

## 1. App Shell

### Brand: PandoShare
Purpose: product identity only.
Backend action: none.

### Left sidebar collapse button
Purpose: hide/show the left navigation rail.
Backend action: none by default. Optional: persist user preference.

### Left/right resize handles
Purpose: drag to resize sidebars.
Backend action: none by default. Optional: persist layout preference.

### Right panel collapse/expand/full-expand buttons
Purpose: control the visible tool panel area.
Backend action: none for the layout itself. Only the tool content inside the panel needs backend data.

## 2. Left Top Navigation

### New conversation
Purpose: create a new conversation.
Behavior:
- If the current active conversation belongs to a project, create the new conversation inside that same project.
- If the current active conversation is in the global conversation list, create a new global conversation.
Backend action:
- `createConversation(scope)`
- scope can be `{ type: "global" }` or `{ type: "project", projectId }`
- return the new conversation ID, title, created time, and empty initial message list.

### Search
Purpose: search projects, conversations, files, tasks, messages, plugins, and possibly command history.
Current prototype: button exists, search surface not implemented yet.
Backend action later:
- `searchWorkspace(query, filters)`
- return grouped results: conversations, projects, files, tasks, messages, plugins.

### Plugins
Purpose: open the Plugins workspace.
Backend action:
- Load plugin/skill/MCP metadata.
- Suggested calls: `listPlugins()`, `listSkills()`, `listMcpServers()`.
Current content placeholder: tabs show "Plugins", "Skills", "MCP"; right side says "敬请期待".

### More
Purpose: opens secondary app menu.
Menu items:
- Heartbeat
- loop 7*24
- GUI operation
Backend action:
- Heartbeat opens the Heartbeat Task Center and needs real task data.
- loop 7*24 is a placeholder for future always-on loop management.
- GUI operation is a placeholder for future computer/browser/mobile control.

## 3. Sidebar Sections

### Pinned section
Purpose: shows globally pinned projects and globally pinned conversations mixed together.
Backend action:
- `listPinnedItems()`
- `pinItem(kind, id)`
- `unpinItem(kind, id)`
Important:
- A whole project pinned globally appears in the top Pinned section.
- A global conversation pinned globally appears in the top Pinned section.
- A conversation inside a project, when pinned, stays at the top of that project only, not in the global Pinned section.

### Projects section
Purpose: shows project folders and project conversations.
Backend action:
- `listProjects()`
- `createProject()`
- `renameProject(projectId, title)`
- `archiveProject(projectId)`
- `deleteProject(projectId)` later if allowed.

### Conversations section
Purpose: shows global conversations outside projects.
Backend action:
- `listConversations(scope: global)`
- `createConversation(scope: global)`
- `renameConversation(conversationId, title)`
- `archiveConversation(conversationId)`
- `deleteConversation(conversationId)` later if allowed.

### Section fold/unfold buttons
Purpose: collapse/expand Pinned, Projects, and Conversations sections.
Backend action: none by default. Optional: persist UI preference.

### Section create buttons
Project section create button:
- Creates a new project.
- Backend action: `createProject({ title })`.

Conversation section create button:
- Creates a new global conversation.
- Backend action: `createConversation({ type: "global" })`.

Section "more" buttons:
- Opens future menu for section-level operations.
- Backend action later depends on menu items, such as sort, filter, import, archive all.

## 4. Project Rows

### Project folder row
Purpose: shows a project and folds/unfolds its inner conversations.
Backend action for fold/unfold: none.
Backend action for project data:
- `getProject(projectId)`
- `listConversations({ type: "project", projectId })`

### Project pin button
Purpose: pin/unpin the whole project to the global Pinned section.
Backend action:
- `pinItem("project", projectId)`
- `unpinItem("project", projectId)`

### Project new conversation button
Purpose: create a conversation inside that project.
Backend action:
- `createConversation({ type: "project", projectId })`

### Project more button
Purpose: future project menu.
Expected actions:
- Rename project
- Archive project
- Delete project if allowed
- Open in new window
- Project settings
Backend action: implement when menu items are finalized.

## 5. Conversation Rows

### Global conversation row
Purpose: open a global conversation.
Backend action:
- `getConversation(conversationId)`
- `listMessages(conversationId)`
- subscribe to conversation updates if streaming/realtime is enabled.

### Project conversation row
Purpose: open a conversation under a project.
Backend action:
- Same as global conversation, but backend should preserve `projectId`.

### Conversation pin button in global conversation list
Purpose: pin/unpin to global Pinned section.
Backend action:
- `pinItem("conversation", conversationId)`
- `unpinItem("conversation", conversationId)`

### Conversation pin button inside a project
Purpose: move the conversation to the top of its own project.
Backend action:
- `setProjectConversationPinned(projectId, conversationId, pinned)`
Important: this is not the same as global pinned.

### Conversation more button
Purpose: future conversation menu.
Expected actions:
- Pin conversation
- Rename conversation
- Archive conversation
- Open side chat
- Copy
- Branch
- Add automation
- Open in new window

## 6. Main Chat Header

### Conversation title pill
Purpose: shows the active conversation title.
Backend action:
- Source from `Conversation.title`.
- Optional: update title automatically after first message if backend supports title generation.

### Header more button
Purpose: opens the conversation action menu.
Menu actions and backend mapping:
- Pin conversation: `pinItem` or project-local pin depending on scope.
- Rename conversation: `renameConversation(conversationId, title)`.
- Archive conversation: `archiveConversation(conversationId)`.
- Open side chat: open or create a side-chat session tied to the active conversation.
- Copy: local frontend action unless copying server-generated share data.
- Branch: `createConversationBranch(conversationId, fromMessageId?)`.
- Add automation: create a scheduled/triggered automation from this conversation.
- Open in new window: frontend/Tauri window action; backend may provide route/session ID.

## 7. Chat Transcript

### User message bubble
Purpose: displays user messages.
Backend source: `Message` with `role = "user"`.

### Assistant reply block
Purpose: displays Agent replies.
Backend source: `Message` with `role = "assistant"`.
Streaming:
- Backend should stream tokens or message deltas.
- Frontend should append/update the assistant message until completion.

### Copy reply button
Purpose: copy assistant reply text to clipboard.
Backend action: none.

### Expand reply button
Purpose: future action to open a larger reply/detail view.
Backend action: none unless expanded view fetches artifacts, citations, or run metadata.

## 8. Composer

### Text input
Purpose: user writes the prompt/message.
Backend action: none until send.

### Plus button
Purpose: opens attachment/action menu.
Menu items:
- Add file
- Add folder
- Select skill
- Select plugin
Backend action:
- Add file: upload file, create file attachment record, attach to current conversation.
- Add folder: select/import folder metadata, attach selected files or workspace path.
- Select skill: `listSkills()` and attach selected skill invocation to next message.
- Select plugin: `listPlugins()` and attach selected plugin/tool context to next message.

### Slash command menu
Purpose: when user types `/`, show available commands and skills.
Current placeholders:
- MCP
- Personality
- Code review
- Side chat
- Initialize
- Compress
- Feedback
- Pet
- Quick
- Reasoning mode
- Skills: Skill 1, Skill 2, Skill 3
Backend action:
- `listSlashCommands(context)`
- `listSkills(context)`
- When selected, the frontend should insert command metadata or trigger the command.

### Approval mode dropdown
Purpose: tells the Agent how to request/handle permissions.
Options:
- Request approval
- Approve for me
- Full access
Backend action:
- Include selected approval mode in `sendMessage`.
- Backend Agent uses it to decide whether to stop and ask user, auto-approve low-risk actions, or run with full access.
Important: backend must still enforce real security rules. The frontend label is not a security boundary.

### Model dropdown
Purpose: choose model/provider before sending.
Placeholder providers/models:
- DeepSeek: DeepSeek V4 Pro, DeepSeek V4 Flash, DeepSeek R1
- MiniMax: MiniMax M3, MiniMax K2.6, MiniMax 2.7
- GLM: GLM 5.15.2, GLM-4-Plus, GLM 5 Turbo
- Qwen: Qwen3.7 Max, Qwen3.6 Plus, Qwen2.5-VL
Backend action:
- `listModels()`
- `setConversationModel(conversationId, modelId)` or pass `modelId` with `sendMessage`.

### Context meter
Purpose: shows context usage as a circular progress indicator.
Current placeholder: used 30K / total 100K, remaining 70%.
Backend action:
- Return context usage per conversation/run.
- Suggested fields: `usedTokens`, `maxTokens`, `usedPercent`, `remainingPercent`.

### Microphone button
Purpose: future voice input.
Backend action later:
- Browser/Tauri captures audio.
- Backend or local service transcribes audio into text.

### Send button
Purpose: send the current message to the Agent.
Backend action:
- `sendMessage(conversationId, text, attachments, modelId, approvalMode, selectedSkills, selectedPlugins)`
- Return or stream a run:
  - `runId`
  - user message
  - assistant message placeholder
  - stream deltas
  - final assistant message
  - updated context usage
  - tool calls/artifacts if any

## 9. Right Tool Panel

### Tool header pill
Purpose: labels the panel as Tools.
Backend action: none.

### Full expand/collapse button
Purpose: expands the tool panel to cover the main chat area.
Backend action: none.

### Collapse right panel button
Purpose: hide/show the right tool panel.
Backend action: none.

### Review tool
Purpose: review code/files/changes/results.
Backend action later:
- Load review queue, diff summaries, review findings, approvals.

### Terminal tool
Purpose: show terminal sessions or command execution UI.
Backend action later:
- Create terminal session.
- Stream terminal output.
- Send terminal input.
- Handle permissions.

### Browser tool
Purpose: show controlled browser/session.
Backend action later:
- Create browser session.
- Navigate/click/type/screenshot through Agent tool runtime.

### Files tool
Purpose: inspect workspace files, uploaded files, artifacts.
Backend action later:
- List files.
- Open file content.
- Upload/download artifacts.

### Side chat tool
Purpose: open a side conversation panel tied to active context.
Backend action later:
- Create/list side chat messages.
- Link side chat to main conversation ID.

## 10. Heartbeat Task Center

Opened from More -> Heartbeat.

### Heartbeat status
Purpose: shows whether heartbeat is running or paused.
Backend action:
- `getHeartbeatStatus()`
- `setHeartbeatRunning(running)`

### Heartbeat search
Purpose: search heartbeat settings/tasks.
Backend action:
- `searchHeartbeat(query)`.

### Heartbeat left sections
Sections:
- Create scheduled task
- Scheduled task list
- Run history
- Exceptions and recovery
Backend action:
- Section switch itself is frontend state.
- Each section fetches its own data.

### Top pause/wake button
Purpose: one button toggles heartbeat running/paused.
Backend action:
- If running: `pauseHeartbeat()`.
- If paused: `wakeHeartbeat()` or `resumeHeartbeat()`.

### Refresh button
Purpose: reload heartbeat data.
Backend action:
- refetch status, task list, history, and exceptions.

### Create scheduled task form
Fields:
- Task name
- Execution method
- Execution time
- Task content
- Action type
- Send target
- Retry count
- Retry interval
Buttons:
- Cancel: frontend clears/exits form.
- Save task: `createScheduledTask(payload)`.
- Save and run now: `createScheduledTask(payload)` then `runScheduledTask(taskId)`.

### Scheduled task list
Purpose: show tasks and selected task details.
Backend action:
- `listScheduledTasks()`
- `getScheduledTask(taskId)`
Task detail actions:
- Run now: `runScheduledTask(taskId)`
- Pause task: `pauseScheduledTask(taskId)`
- Edit: `updateScheduledTask(taskId, payload)`
- Delete: `deleteScheduledTask(taskId)`
- View history: `listScheduledTaskRuns(taskId)`
- View Replay: `getReplay(runId)`

### Run history
Purpose: show past heartbeat runs.
Backend action:
- `listHeartbeatRuns(filters)`
Row actions:
- View log: `getRunLog(runId)`
- Replay: `getReplay(runId)`
- Rerun: `rerunHeartbeatRun(runId)`

### Exceptions and recovery
Purpose: show failed/stuck tasks and recovery actions.
Backend action:
- `listHeartbeatExceptions()`
Row actions:
- Retry: `retryException(exceptionId)`
- Skip this time: `skipException(exceptionId)`
- Mark handled: `markExceptionHandled(exceptionId)`
- Replay: `getReplay(runId)`

## 11. Settings

Opened from bottom-left Settings button.

### Back to app
Purpose: return from Settings to main app.
Backend action: none.

### Settings search
Purpose: search settings pages.
Backend action later:
- Search local settings metadata or backend settings schema.

### Settings nav groups
Current left-side placeholders:
- Personal: General, Profile, Appearance, Configuration, Personalization, Keyboard shortcuts, Usage and billing
- Integrations: MCP servers, Browser, Computer control
- Coding: Hooks, Connections, Git, Environment, Worktree
- Archived: Archived conversations
Backend action later:
- Each page should fetch/save its own settings.
- Current right side is placeholder "敬请期待".

## 12. Plugins Workspace

Opened from top-left Plugins button.

Tabs:
- Plugins
- Skills
- MCP
Backend action:
- Plugins tab: `listPlugins()`, install/enable/disable/update later.
- Skills tab: `listSkills()`, enable/disable/configure later.
- MCP tab: `listMcpServers()`, connect/disconnect/status later.
Current content placeholder: "敬请期待".

## 13. Suggested First Backend Contract

Start with these backend surfaces first:

1. `GET /api/workspace`
Return projects, conversations, pinned items, active defaults, right tools, model list, plugin tabs, heartbeat status.

2. `POST /api/conversations`
Create global or project conversation.

3. `GET /api/conversations/:id/messages`
Load messages.

4. `POST /api/conversations/:id/messages`
Send a user message and start an Agent run.

5. `GET /api/runs/:id/stream`
Stream assistant response, tool calls, logs, artifacts, and final status.

6. `POST /api/pins`
Pin project or conversation.

7. `DELETE /api/pins/:id`
Unpin project or conversation.

8. `GET /api/models`
Return provider/model list.

9. `GET /api/plugins`, `GET /api/skills`, `GET /api/mcp`
Return tool/plugin/skill/MCP metadata.

10. `GET /api/heartbeat/status`, `GET /api/heartbeat/tasks`, `POST /api/heartbeat/tasks`
Start heartbeat integration.

## 14. Frontend State That Should Stay Local

Do not make the backend responsible for these unless we explicitly decide to persist user preferences:
- Sidebar collapsed/expanded
- Section folded/unfolded
- Panel width while dragging
- Dropdown open/closed
- Hover action visibility
- Current selected settings/plugin tab
- Tooltip visibility
- Copy-to-clipboard state

## 15. Integration Priority

Recommended order:
1. Workspace load: projects, conversations, pinned items.
2. Conversation create/open/send/stream.
3. Model list and selected model.
4. Attachments and slash command list.
5. Plugin/skill/MCP metadata.
6. Right tool panel data.
7. Heartbeat task center.
8. Settings persistence.

