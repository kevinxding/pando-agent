import type { ChangeEvent, ComponentType, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Calendar,
  Clock,
  Edit3,
  ExternalLink,
  Filter,
  History,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  ChevronsLeftRight,
  Circle,
  Code2,
  Copy,
  Cpu,
  FilePlus2,
  Files,
  Folder,
  FolderInput,
  Gauge,
  GitBranch,
  HeartPulse,
  Laptop,
  Maximize2,
  Menu,
  MessageSquarePlus,
  MessagesSquare,
  Minimize2,
  Mic,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  PackagePlus,
  PanelRight,
  Pin,
  Plus,
  Search,
  SendHorizontal,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Target,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import {
  clearThreadGoal,
  createConversation,
  continueThreadGoal,
  createProject,
  createScheduledTask,
  deleteProviderConnection,
  deleteScheduledTask,
  loadConversationEvents,
  loadConversationMessages,
  loadHeartbeatSnapshot,
  loadModelGroups,
  loadPendingApprovals,
  loadProviderConnections,
  loadWorkspaceSnapshot,
  pauseScheduledTask,
  runScheduledTask,
  resolveApproval,
  saveProviderConnection,
  sendConversationMessage,
  setHeartbeatRunning as setHeartbeatRunningBackend,
  setPinnedItem,
  setThreadGoal,
  streamRun,
  unsetPinnedItem,
  loadThreadGoal,
  type AgentRunEvent,
  type ApprovalDecision,
  type HeartbeatTaskInput,
  type UiGoalSummary,
  type UiProviderConnection,
} from './backendApi'

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>

type NavItem = {
  label: string
  icon: IconType
}

type Project = {
  id?: string
  name: string
  chats: ProjectChat[]
}

type PinnedKind = 'project' | 'chat'

type PinnedItem = {
  id: string
  kind: PinnedKind
  sourceId?: string
  sourceName: string
  label: string
}

type ProjectChat = {
  id?: string
  name: string
  pinned: boolean
  created?: boolean
}

type ActiveChat = {
  id: string
  title: string
  conversationId?: string
  projectId?: string
}

type WorkspaceView = 'chat' | 'heartbeat' | 'settings' | 'plugins'

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  time: string
  attachments?: MessageAttachment[]
  activities?: ActivityPart[]
  timelineParts?: AssistantTimelinePart[]
  streaming?: boolean
}

type MessageAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  previewUrl?: string
  path?: string
}

type ActivityKind = 'turn' | 'context' | 'model' | 'tool' | 'approval' | 'gui' | 'result' | 'error'

type ActivityStatus = 'pending' | 'running' | 'waiting_approval' | 'approved' | 'rejected' | 'completed' | 'failed'

type ActivityPart = {
  id: string
  kind: ActivityKind
  status: ActivityStatus
  title: string
  summary: string
  detail?: string
  toolCallId?: string
  approvalId?: string
  startedAtMs?: number
  completedAtMs?: number
  inputPreview?: string
  outputPreview?: string
}

type AssistantTimelinePart =
  | {
      id: string
      type: 'text'
      text: string
    }
  | {
      id: string
      type: 'activity'
      activity: ActivityPart
    }

type SmoothWriterState = {
  queue: string
  timer: number | null
  completed: boolean
  pendingActivities: ActivityPart[]
}

type ComposerSendPayload = {
  message: string
  approvalMode: string
  modelId?: string
  goalId?: string
  attachments?: MessageAttachment[]
}

type ContextUsage = {
  usedTokens?: number
  totalTokens?: number
  percentUsed?: number
  remainingPercent?: number
  estimated: boolean
  source: 'token_budget' | 'model_usage' | 'char_estimate'
  updatedAtMs?: number
}

type AttachedGoal = {
  goalId?: string
  threadId?: string
  text: string
  paused: boolean
  progressPercent?: number
  status?: string
  tokenBudget?: number
  tokensUsed?: number
  timeUsedSeconds?: number
}

type PendingApprovalStatus = 'pending' | 'submitting' | 'approved' | 'rejected' | 'failed'

type PendingApprovalItem = {
  id: string
  threadId?: string
  toolName: string
  reason?: string
  risk?: string
  safety?: string
  sandboxMode?: string
  approvalPolicy?: string
  inputPreview?: string
  createdAtMs?: number
  status: PendingApprovalStatus
  error?: string
}

const goalSummaryToAttachedGoal = (goal: UiGoalSummary): AttachedGoal => ({
  goalId: goal.goalId ?? goal.id,
  threadId: goal.threadId,
  text: goal.objective || goal.title,
  paused: goal.status !== 'active',
  progressPercent: goal.progressPercent,
  status: goal.status,
  tokenBudget: goal.tokenBudget,
  tokensUsed: goal.tokensUsed,
  timeUsedSeconds: goal.timeUsedSeconds,
})

const quickActions: NavItem[] = [
  { label: '新对话', icon: MessageSquarePlus },
  { label: '搜索', icon: Search },
  { label: '插件', icon: PackagePlus },
]

const moreActions: NavItem[] = [
  { label: '心跳', icon: HeartPulse },
  { label: 'loop 7*24', icon: Activity },
  { label: 'GUI操作', icon: MousePointer2 },
]

const pluginTabs = ['\u63d2\u4ef6', '\u6280\u80fd', 'MCP']

const settingsGroups = [
  {
    title: '\u4e2a\u4eba',
    items: [
      { id: 'general', label: '\u5e38\u89c4', icon: Settings },
      { id: 'profile', label: '\u4e2a\u4eba\u8d44\u6599', icon: Bot },
      { id: 'appearance', label: '\u5916\u89c2', icon: Sparkles },
      { id: 'configuration', label: '\u914d\u7f6e', icon: SlidersHorizontal },
      { id: 'personalization', label: '\u4e2a\u6027\u5316', icon: Gauge },
      { id: 'shortcuts', label: '\u952e\u76d8\u5feb\u6377\u952e', icon: TerminalSquare },
      { id: 'usage', label: '\u4f7f\u7528\u60c5\u51b5\u548c\u8ba1\u8d39', icon: Activity },
    ],
  },
  {
    title: '\u96c6\u6210',
    items: [
      { id: 'mcp', label: 'MCP \u670d\u52a1\u5668', icon: PackagePlus },
      { id: 'browser', label: '\u6d4f\u89c8\u5668', icon: PanelRight },
      { id: 'computer', label: '\u7535\u8111\u64cd\u63a7', icon: MousePointer2 },
    ],
  },
  {
    title: '\u7f16\u7801',
    items: [
      { id: 'hooks', label: '\u94a9\u5b50', icon: GitBranch },
      { id: 'connections', label: '\u8fde\u63a5', icon: ExternalLink },
      { id: 'git', label: 'Git', icon: Code2 },
      { id: 'environment', label: '\u73af\u5883', icon: Cpu },
      { id: 'worktree', label: '\u5de5\u4f5c\u6811', icon: FolderInput },
    ],
  },
  {
    title: '\u5df2\u5f52\u6863',
    items: [
      { id: 'archived', label: '\u5df2\u5f52\u6863\u5bf9\u8bdd', icon: Archive },
    ],
  },
]

const initialPinnedItems: PinnedItem[] = []

const projects: Project[] = []

const chats: string[] = []
type AttachActionItem = NavItem & { id?: 'goal' | 'file' | 'folder' }

const attachActions: AttachActionItem[] = [
  { id: 'goal', label: 'Goal / \u76ee\u6807', icon: Target },
  { id: 'file', label: '添加文件', icon: FilePlus2 },
  { id: 'folder', label: '添加文件夹', icon: FolderInput },
  { label: '选择技能', icon: Sparkles },
  { label: '选择插件', icon: PackagePlus },
]

const mcpServerPlaceholders = [
  'cua-driver',
  'dingxu_human_gui',
  'node_repl',
  'open-computer-use',
  'pando',
  'windows-mcp',
]

type SlashCommandItem = NavItem & { id?: 'goal'; description: string }

const slashCommandActions: SlashCommandItem[] = [
  { id: 'goal', label: 'Goal / \u76ee\u6807', description: 'Create and attach a local goal', icon: Target },
  { label: 'MCP', description: '显示 MCP 服务器状态', icon: Code2 },
  { label: '个性', description: '选择 Codex 的回应方式', icon: Gauge },
  { label: '代码审查', description: '审查未暂存的更改，或与某个分支进行比较', icon: ShieldCheck },
  { label: '侧边', description: '在临时分支中发起侧边对话', icon: MessagesSquare },
  { label: '初始化', description: '创建包含 Codex 说明的 AGENTS.md 文件', icon: FilePlus2 },
  { label: '压缩', description: '压缩此会话的上下文（已使用 56%）', icon: Circle },
  { label: '反馈', description: '发送有关此聊天的反馈', icon: ThumbsUp },
  { label: '宠物', description: '唤醒或收起桌面宠物', icon: Bot },
  { label: '快速', description: '关闭快速并返回标准速度', icon: Activity },
  { label: '推理模式', description: '超高', icon: Sparkles },
]

const slashSkillActions = ['技能一', '技能二', '技能三']

type SlashMenuState = {
  query: string
  commands: SlashCommandItem[]
  skills: string[]
}

const matchesSlashQuery = (text: string, query: string) => text.toLocaleLowerCase().includes(query)

const getSlashMenuState = (message: string): SlashMenuState | null => {
  const trimmedMessage = message.trimStart()

  if (!trimmedMessage.startsWith('/')) {
    return null
  }

  const queryText = trimmedMessage.slice(1)

  if (/\s/.test(queryText)) {
    return null
  }

  const query = queryText.toLocaleLowerCase()

  if (!query) {
    return { query, commands: slashCommandActions, skills: slashSkillActions }
  }

  const commands = slashCommandActions.filter(
    (item) => matchesSlashQuery(item.label, query) || matchesSlashQuery(item.description, query),
  )
  const skills = slashSkillActions.filter((skill) => matchesSlashQuery(skill, query) || matchesSlashQuery("Skill", query))

  if (commands.length === 0 && skills.length === 0) {
    return null
  }

  return { query, commands, skills }
}

const rightTools: NavItem[] = [
  { label: '审查', icon: ShieldCheck },
  { label: '终端', icon: TerminalSquare },
  { label: '浏览器', icon: PanelRight },
  { label: '文件', icon: Files },
  { label: '侧边聊天', icon: MessagesSquare },
]

const approvalModes = [
  { id: 'request_approval', label: '\u8bf7\u6c42\u6279\u51c6' },
  { id: 'auto_review', label: '\u66ff\u6211\u5ba1\u6279' },
  { id: 'full_access', label: '\u5b8c\u5168\u8bbf\u95ee\u6743\u9650' },
] as const

const defaultApprovalMode = approvalModes[0].id
const approvalModeLabel = (modeId: string) =>
  approvalModes.find((mode) => mode.id === modeId)?.label ?? approvalModes[0].label

type ModelGroup = {
  provider: string
  models: string[]
}

const defaultModelLabel = '\u9009\u62e9\u6a21\u578b'
const modelVisibilityKey = (provider: string, model: string) => `${provider}::${model}`
const modelVisibilityKeys = (groups: ModelGroup[]) =>
  groups.flatMap((group) => group.models.map((model) => modelVisibilityKey(group.provider, model)))

const modelGroups: ModelGroup[] = []

const MODEL_SELECTION_STORAGE_KEY = 'pando:selected-model:v1'

const readStoredSelectedModel = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const value = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY)?.trim()
    return value || undefined
  } catch {
    return undefined
  }
}

const writeStoredSelectedModel = (model: string | undefined) => {
  if (typeof window === 'undefined') return
  try {
    if (model && model !== defaultModelLabel) window.localStorage.setItem(MODEL_SELECTION_STORAGE_KEY, model)
    else window.localStorage.removeItem(MODEL_SELECTION_STORAGE_KEY)
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

const firstModelFromGroups = (groups: ModelGroup[]) => groups.find((group) => group.models.length > 0)?.models[0]
const modelExistsInGroups = (groups: ModelGroup[], model: string) =>
  model !== defaultModelLabel && groups.some((group) => group.models.includes(model))

const backendUnavailableReply = '后端或模型请求失败，请检查 Pando 后端状态后重试。'
const assistantThinkingText = '正在思考'

const initialMessages: ChatMessage[] = []

const formatMessageTime = () => {
  const now = new Date()

  return `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
}

const takeSmoothStreamChunk = (queue: string, completed: boolean) => {
  const chars = Array.from(queue)
  const length = chars.length
  const size = length > 240 ? 24 : length > 120 ? 12 : length > 60 ? 6 : completed && length > 24 ? 3 : 1

  return {
    chunk: chars.slice(0, size).join(''),
    rest: chars.slice(size).join(''),
    delayMs: completed || length > 80 ? 8 : 22,
  }
}

const CODEX_CONTEXT_BASELINE_TOKENS = 12_000
const DEFAULT_CONTEXT_CHARS_PER_TOKEN = 4

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

const codexContextPercentUsed = (usedTokens: number | undefined, totalTokens: number | undefined) => {
  if (usedTokens === undefined || totalTokens === undefined || totalTokens <= 0) {
    return undefined
  }

  if (totalTokens <= CODEX_CONTEXT_BASELINE_TOKENS) {
    return clampPercent((usedTokens / totalTokens) * 100)
  }

  const effectiveWindow = totalTokens - CODEX_CONTEXT_BASELINE_TOKENS
  const effectiveUsed = Math.max(0, usedTokens - CODEX_CONTEXT_BASELINE_TOKENS)

  return clampPercent((effectiveUsed / effectiveWindow) * 100)
}

const createContextUsage = (input: {
  usedTokens?: number
  totalTokens?: number
  estimated: boolean
  source: ContextUsage['source']
  updatedAtMs?: number
}): ContextUsage | undefined => {
  const usedTokens = input.usedTokens !== undefined ? Math.max(0, Math.round(input.usedTokens)) : undefined
  const totalTokens = input.totalTokens !== undefined ? Math.max(1, Math.round(input.totalTokens)) : undefined

  if (usedTokens === undefined && totalTokens === undefined) {
    return undefined
  }

  const percentUsed = codexContextPercentUsed(usedTokens, totalTokens)

  return {
    usedTokens,
    totalTokens,
    percentUsed,
    remainingPercent: percentUsed !== undefined ? 100 - percentUsed : undefined,
    estimated: input.estimated,
    source: input.source,
    updatedAtMs: input.updatedAtMs,
  }
}

const formatTokenAmount = (tokens: number | undefined) => {
  if (tokens === undefined) return '--'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`

  return String(tokens)
}

const describeContextUsage = (usage: ContextUsage | undefined) => {
  if (!usage) {
    return '上下文占用等待后端事件'
  }

  const prefix = usage.estimated ? '估算' : '实际'
  const used = formatTokenAmount(usage.usedTokens)

  if (usage.percentUsed !== undefined && usage.remainingPercent !== undefined && usage.totalTokens !== undefined) {
    return `${prefix}剩余${usage.remainingPercent}%，已用${used}上下文，共${formatTokenAmount(usage.totalTokens)}`
  }

  if (usage.usedTokens !== undefined) {
    return `${prefix}已用${used}上下文，模型窗口未知`
  }

  return '上下文占用等待后端事件'
}

const createAttachmentId = () => `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const isImageAttachment = (attachment: MessageAttachment) => attachment.mimeType.startsWith('image/') && Boolean(attachment.previewUrl)

const formatAttachmentSize = (size: number) => {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`

  return `${size} B`
}

const fileToMessageAttachment = (file: File): MessageAttachment => {
  const fileWithPath = file as File & { webkitRelativePath?: string }
  const path = fileWithPath.webkitRelativePath || file.name

  return {
    id: createAttachmentId(),
    name: file.name,
    path,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
  }
}
const getPinnedId = (kind: PinnedKind, sourceName: string) => `${kind}:${sourceName}`
const getSidebarChatId = (chatName: string) => `chat:${chatName}`
const getProjectChatId = (projectName: string, chatName: string) => `project:${projectName}:${chatName}`

const getActiveProjectName = (chatId: string) => {
  if (!chatId.startsWith('project:')) {
    return null
  }

  const [, projectName] = chatId.split(':')
  return projectName || null
}

const createSidebarActiveChat = (chatName: string, conversationId?: string): ActiveChat => ({
  id: getSidebarChatId(conversationId ?? chatName),
  title: chatName,
  conversationId,
})

const createProjectActiveChat = (projectName: string, chatName: string, conversationId?: string, projectId?: string): ActiveChat => ({
  id: getProjectChatId(projectName, conversationId ?? chatName),
  title: chatName,
  conversationId,
  projectId,
})

const createPinnedItem = (kind: PinnedKind, sourceName: string, sourceId?: string): PinnedItem => ({
  id: getPinnedId(kind, sourceId ?? sourceName),
  kind,
  sourceId,
  sourceName,
  label: `???${sourceName}`,
})

const sortProjectChats = (chatRows: ProjectChat[]) =>
  [...chatRows].sort((firstChat, secondChat) => Number(secondChat.pinned) - Number(firstChat.pinned))

const createNewChatName = (chatNames: string[]) => {
  const newChatCount = chatNames.filter((chatName) => chatName === '新会话' || chatName.startsWith('新会话 ')).length

  return newChatCount === 0 ? '新会话' : `新会话 ${newChatCount + 1}`
}

function SidebarButton({
  item,
  active = false,
  onClick,
}: {
  item: NavItem
  active?: boolean
  onClick?: () => void
}) {
  const Icon = item.icon

  return (
    <button className={active ? 'nav-button active' : 'nav-button'} type="button" onClick={onClick}>
      <Icon size={16} strokeWidth={1.9} />
      <span>{item.label}</span>
    </button>
  )
}

function SectionHeader({
  title,
  showMore = false,
  createLabel,
  createIcon: CreateIcon = Plus,
  onCreate,
  expanded,
  onToggle,
}: {
  title: string
  showMore?: boolean
  createLabel?: string
  createIcon?: IconType
  onCreate?: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const createButtonLabel = createLabel ?? `${title}新建`

  return (
    <div className="section-header">
      <button
        className={`section-toggle ${expanded ? '' : 'collapsed'}`}
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? '折叠' : '展开'}${title}`}
        onClick={onToggle}
      >
        <ChevronDown className="section-chevron" size={13} />
        <span>{title}</span>
      </button>
      {onCreate ? (
        <button
          className="icon-ghost section-create-button"
          type="button"
          aria-label={createButtonLabel}
          title={createButtonLabel}
          onClick={onCreate}
        >
          <CreateIcon size={14} />
        </button>
      ) : null}
      {showMore ? (
        <button className="icon-ghost" type="button" aria-label={`${title}更多`}>
          <MoreHorizontal size={15} />
        </button>
      ) : null}
    </div>
  )
}

function NestedChatRow({
  chat,
  pinned = false,
  created = false,
  active = false,
  onOpenChat,
  onTogglePin,
}: {
  chat: string
  pinned?: boolean
  created?: boolean
  active?: boolean
  onOpenChat: () => void
  onTogglePin: () => void
}) {
  return (
    <div
      className={`nested-chat ${pinned ? 'pinned-chat' : ''} ${created ? 'created-chat' : ''} ${
        active ? 'active-chat' : ''
      }`}
    >
      <button
        className="nested-chat-main"
        type="button"
        aria-label={chat}
        aria-current={active ? 'page' : undefined}
        onClick={onOpenChat}
      >
        <span>{chat}</span>
      </button>
      <div className="nested-chat-actions">
        <button
          className={`icon-ghost nested-pin-button ${pinned ? 'active' : ''}`}
          type="button"
          aria-label={`${chat}${pinned ? '取消置顶' : '置顶'}`}
          aria-pressed={pinned}
          title={pinned ? '取消置顶' : '置顶'}
          onClick={onTogglePin}
        >
          <Pin size={13} />
        </button>
        <button className="icon-ghost" type="button" aria-label={`${chat}更多`}>
          <MoreHorizontal size={13} />
        </button>
      </div>
    </div>
  )
}

function SidebarChatRow({
  chat,
  pinned,
  active,
  onOpenChat,
  onTogglePin,
  onCreateChat,
}: {
  chat: string
  pinned: boolean
  active: boolean
  onOpenChat: () => void
  onTogglePin: () => void
  onCreateChat: () => void
}) {
  return (
    <div className={`sidebar-chat-row ${pinned ? 'pinned-chat' : ''} ${active ? 'active-chat' : ''}`}>
      <button
        className="sidebar-chat-main"
        type="button"
        aria-label={chat}
        aria-current={active ? 'page' : undefined}
        onClick={onOpenChat}
      >
        <span>{chat}</span>
      </button>
      <div className="sidebar-chat-actions">
        <button
          className={`icon-ghost sidebar-pin-button ${pinned ? 'active' : ''}`}
          type="button"
          aria-label={`${chat}${pinned ? '取消置顶' : '置顶'}`}
          aria-pressed={pinned}
          title={pinned ? '取消置顶' : '置顶'}
          onClick={onTogglePin}
        >
          <Pin size={13} />
        </button>
        <button
          className="icon-ghost sidebar-create-chat"
          type="button"
          aria-label={`${chat}创建新对话`}
          title="创建新对话"
          onClick={onCreateChat}
        >
          <MessageSquarePlus size={13} />
        </button>
        <button className="icon-ghost" type="button" aria-label={`${chat}更多`}>
          <MoreHorizontal size={13} />
        </button>
      </div>
    </div>
  )
}

function ProjectBlock({
  project,
  isPinned,
  activeChatId,
  onOpenChat,
  onCreateChat,
  onTogglePin,
  onToggleChatPin,
}: {
  project: Project
  isPinned: boolean
  activeChatId: string
  onOpenChat: (chat: ActiveChat) => void
  onCreateChat: (projectName: string) => void
  onTogglePin: () => void
  onToggleChatPin: (projectName: string, chatName: string) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className={`project-block ${expanded ? '' : 'collapsed'}`}>
      <div className="project-title-row">
        <button
          className="project-title-main"
          type="button"
          aria-expanded={expanded}
          aria-label={`${project.name}${expanded ? '折叠' : '展开'}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <Folder size={15} />
          <span>{project.name}</span>
          <ChevronDown className="project-chevron" size={14} />
        </button>
        <div className="project-actions">
          <button
            className={`icon-ghost project-pin-button ${isPinned ? 'active' : ''}`}
            type="button"
            aria-label={`${project.name}${isPinned ? '取消置顶' : '置顶'}`}
            aria-pressed={isPinned}
            title={isPinned ? '取消置顶' : '置顶'}
            onClick={onTogglePin}
          >
            <Pin size={14} />
          </button>
          <button
            className="icon-ghost project-create-chat"
            type="button"
            aria-label={`${project.name}创建新对话`}
            title="创建新对话"
            onClick={() => {
              setExpanded(true)
              onCreateChat(project.name)
            }}
          >
            <MessageSquarePlus size={14} />
          </button>
          <button className="icon-ghost" type="button" aria-label={`${project.name}更多`}>
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            className="nested-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {project.chats.map((chat, chatIndex) => (
              <NestedChatRow
                chat={chat.name}
                pinned={chat.pinned}
                created={chat.created}
                active={activeChatId === getProjectChatId(project.name, chat.id ?? chat.name)}
                onOpenChat={() => onOpenChat(createProjectActiveChat(project.name, chat.name, chat.id, project.id))}
                onTogglePin={() => onToggleChatPin(project.name, chat.name)}
                key={`${project.id ?? project.name}:${chat.id ?? chat.name}:${chatIndex}`}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function SettingsSidebar({
  collapsed,
  activeSetting,
  onSettingChange,
  onBackApp,
}: {
  collapsed: boolean
  activeSetting: string
  onSettingChange: (setting: string) => void
  onBackApp: () => void
}) {
  return (
    <aside className={`left-sidebar settings-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="\u8bbe\u7f6e\u5bfc\u822a">
      <div className="sidebar-inner settings-sidebar-inner">
        <div className="settings-sidebar-top">
          <button className="settings-back-button" type="button" onClick={onBackApp}>
            <ChevronLeft size={16} />
            <span>{"\u8fd4\u56de\u5e94\u7528"}</span>
          </button>
          <label className="settings-search-box">
            <Search size={15} />
            <input aria-label="Search settings" placeholder={"\u641c\u7d22\u8bbe\u7f6e..."} />
          </label>
        </div>

        <nav className="settings-nav-scroll">
          {settingsGroups.map((group) => (
            <section className="settings-nav-group" key={group.title}>
              <div className="settings-nav-label">{group.title}</div>
              <div className="settings-nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon

                  return (
                    <button
                      className={activeSetting === item.id ? 'settings-nav-item active' : 'settings-nav-item'}
                      type="button"
                      onClick={() => onSettingChange(item.id)}
                      key={item.id}
                    >
                      <Icon size={16} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function LeftSidebar({
  collapsed,
  activeChatId,
  activeView,
  activeSetting,
  onOpenChat,
  onOpenHeartbeat,
  onOpenSettings,
  onCloseSettings,
  onOpenPlugins,
  onSettingChange,
  onToggle,
}: {
  collapsed: boolean
  activeChatId: string
  activeView: WorkspaceView
  activeSetting: string
  onOpenChat: (chat: ActiveChat) => void
  onOpenHeartbeat: () => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  onOpenPlugins: () => void
  onSettingChange: (setting: string) => void
  onToggle: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [openSections, setOpenSections] = useState({ pinned: true, projects: true, chats: true })
  const [pinnedItemsState, setPinnedItemsState] = useState<PinnedItem[]>(initialPinnedItems)
  const [projectItems, setProjectItems] = useState<Project[]>(projects)
  const [chatItems, setChatItems] = useState(chats)
  const [globalChatIds, setGlobalChatIds] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true

    const refreshWorkspace = () => {
      void loadWorkspaceSnapshot()
        .then((snapshot) => {
          if (!active || !snapshot) {
            return
          }

          if (snapshot.projects) {
            setProjectItems(
              snapshot.projects.map((project) => ({
                id: project.id,
                name: project.name,
                chats: project.chats.map((chat) => ({
                  id: chat.id,
                  name: chat.name,
                  pinned: Boolean(chat.pinned),
                })),
              })),
            )
          }

          if (snapshot.chats) {
            setChatItems(snapshot.chats.map((chat) => chat.name))
            setGlobalChatIds(
              Object.fromEntries(snapshot.chats.filter((chat) => chat.id).map((chat) => [chat.name, chat.id as string])),
            )
          }

          if (snapshot.pinnedItems) {
            setPinnedItemsState(
              snapshot.pinnedItems.map((item) => ({
                id: item.id,
                kind: item.kind,
                sourceId: item.sourceId,
                sourceName: item.sourceName,
                label: item.label,
              })),
            )
          }
        })
        .catch(() => undefined)
    }

    refreshWorkspace()
    window.addEventListener('pando:workspace-updated', refreshWorkspace)

    return () => {
      active = false
      window.removeEventListener('pando:workspace-updated', refreshWorkspace)
    }
  }, [])

  const isGlobalPinned = (kind: PinnedKind, sourceName: string, sourceId?: string) =>
    pinnedItemsState.some((item) => item.id === getPinnedId(kind, sourceId ?? sourceName))

  const toggleGlobalPin = (kind: PinnedKind, sourceName: string, sourceId?: string) => {
    const pinId = getPinnedId(kind, sourceId ?? sourceName)
    const isPinned = pinnedItemsState.some((item) => item.id === pinId)

    setOpenSections((currentSections) => ({ ...currentSections, pinned: true }))
    setPinnedItemsState((currentItems) =>
      isPinned
        ? currentItems.filter((item) => item.id !== pinId)
        : [createPinnedItem(kind, sourceName, sourceId), ...currentItems],
    )

    if (isPinned) {
      void unsetPinnedItem(sourceId ?? pinId)
      return
    }

    void setPinnedItem({
      kind: kind === 'project' ? 'project' : 'conversation',
      id: sourceId,
      title: sourceName,
    })
  }

  const createSidebarProject = async () => {
    setOpenSections((currentSections) => ({ ...currentSections, projects: true }))

    const nextProjectNumber = projectItems.filter((project) => project.name.startsWith('\u9879\u76ee X')).length + 1
    const fallbackName = nextProjectNumber === 1 ? '\u9879\u76ee X' : `\u9879\u76ee X${nextProjectNumber}`
    const backendProject = await createProject(fallbackName)
    const nextProject = backendProject
      ? {
          id: backendProject.id,
          name: backendProject.name,
          chats: backendProject.chats.map((chat) => ({ id: chat.id, name: chat.name, pinned: Boolean(chat.pinned) })),
        }
      : { name: fallbackName, chats: [] }

    setProjectItems((currentProjects) => [nextProject, ...currentProjects])
  }

  const createSidebarChat = async () => {
    setOpenSections((currentSections) => ({ ...currentSections, chats: true }))

    const nextChatName = createNewChatName(chatItems)
    const backendChat = await createConversation({ title: nextChatName, scope: { type: 'global' } })
    const chatName = backendChat?.name ?? nextChatName

    if (backendChat?.id) {
      setGlobalChatIds((currentIds) => ({ ...currentIds, [chatName]: backendChat.id as string }))
    }

    setChatItems((currentChats) => [chatName, ...currentChats])
    onOpenChat(createSidebarActiveChat(chatName, backendChat?.id))
  }

  const createProjectChat = async (projectName: string) => {
    const targetProject = projectItems.find((project) => project.name === projectName)

    if (!targetProject) {
      return
    }

    setOpenSections((currentSections) => ({ ...currentSections, pinned: true, projects: true }))

    const nextChatName = createNewChatName(targetProject.chats.map((chat) => chat.name))
    const backendChat = await createConversation({
      title: nextChatName,
      scope: { type: 'project', projectId: targetProject.id, projectName },
    })
    const chatName = backendChat?.name ?? nextChatName
    const nextChat = { id: backendChat?.id, name: chatName, pinned: false, created: true }

    setProjectItems((currentProjects) =>
      currentProjects.map((project) =>
        project.name === projectName
          ? {
              ...project,
              chats: sortProjectChats([nextChat, ...project.chats]),
            }
          : project,
      ),
    )
    onOpenChat(createProjectActiveChat(projectName, chatName, backendChat?.id, targetProject.id))
  }

  const createContextChat = () => {
    const projectName = getActiveProjectName(activeChatId)

    if (projectName) {
      createProjectChat(projectName)
      return
    }

    createSidebarChat()
  }

  const toggleProjectChatPin = (projectName: string, chatName: string) => {
    setProjectItems((currentProjects) =>
      currentProjects.map((project) => {
        if (project.name !== projectName) {
          return project
        }

        const targetChat = project.chats.find((chat) => chat.name === chatName)

        if (!targetChat) {
          return project
        }

        const nextPinned = !targetChat.pinned
        const updatedTarget = { ...targetChat, pinned: nextPinned }
        const otherChats = project.chats.filter((chat) => chat.name !== chatName)
        const chats = nextPinned ? [updatedTarget, ...otherChats] : sortProjectChats([...otherChats, updatedTarget])

        return { ...project, chats }
      }),
    )
  }

  const toggleSection = (section: 'pinned' | 'projects' | 'chats') => {
    setOpenSections((currentSections) => ({
      ...currentSections,
      [section]: !currentSections[section],
    }))
  }

  if (activeView === 'settings') {
    return (
      <SettingsSidebar
        collapsed={collapsed}
        activeSetting={activeSetting}
        onSettingChange={onSettingChange}
        onBackApp={onCloseSettings}
      />
    )
  }

  return (
    <aside className={`left-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="主导航">
      <div className="sidebar-inner">
        <div className="sidebar-top">
          <div className="brand-row">
            <div className="brand-mark">
              <Bot size={17} />
            </div>
            <div className="brand-copy">
              <strong>PandoShare</strong>
            </div>
            <button
              className="collapse-button"
              type="button"
              aria-label={collapsed ? '展开左侧栏' : '折叠左侧栏'}
              onClick={onToggle}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          <nav className="quick-actions">
            {quickActions.map((item, index) => (
              <SidebarButton
                item={item}
                active={activeView === 'plugins' && index === 2}
                onClick={index === 0 ? createContextChat : index === 2 ? onOpenPlugins : undefined}
                key={item.label}
              />
            ))}
            <div className="more-action-wrap">
              <button
                className={`nav-button more-trigger ${moreOpen ? 'active' : ''}`}
                type="button"
                aria-expanded={moreOpen}
                aria-label="更多应用"
                onClick={() => setMoreOpen((value) => !value)}
              >
                <Menu size={16} strokeWidth={1.9} />
                <span>更多</span>
              </button>

              <AnimatePresence>
                {moreOpen ? (
                  <motion.div
                    className="more-app-menu"
                    initial={{ opacity: 0, x: -6, scale: 0.98 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -6, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                  >
                    {moreActions.map((item) => {
                      const Icon = item.icon
                      const isHeartbeat = item.label === "\u5fc3\u8df3"

                      return (
                        <button
                          className={activeView === 'heartbeat' && isHeartbeat ? 'more-app-item active' : 'more-app-item'}
                          type="button"
                          key={item.label}
                          onClick={isHeartbeat ? () => {
                            setMoreOpen(false)
                            onOpenHeartbeat()
                          } : undefined}
                        >
                          <Icon size={17} strokeWidth={1.8} />
                          <span>{item.label}</span>
                        </button>
                      )
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </nav>
        </div>

        <div className="sidebar-scroll">
          <SectionHeader title="置顶" expanded={openSections.pinned} onToggle={() => toggleSection('pinned')} />
          <AnimatePresence initial={false}>
            {openSections.pinned ? (
              <motion.div
                className="list-group collapsible-section"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                {pinnedItemsState.map((item) => {
                  if (item.kind === 'project') {
                    const pinnedProject = projectItems.find((project) => project.name === item.sourceName)

                    if (!pinnedProject) {
                      return null
                    }

                    return (
                      <ProjectBlock
                        project={pinnedProject}
                        isPinned
                        activeChatId={activeChatId}
                        onOpenChat={onOpenChat}
                        onCreateChat={createProjectChat}
                        onTogglePin={() => toggleGlobalPin('project', pinnedProject.name, pinnedProject.id)}
                        onToggleChatPin={toggleProjectChatPin}
                        key={item.id}
                      />
                    )
                  }

                  return (
                    <SidebarChatRow
                      chat={item.sourceName}
                      pinned
                      active={activeChatId === getSidebarChatId(item.sourceId ?? globalChatIds[item.sourceName] ?? item.sourceName)}
                      onOpenChat={() => onOpenChat(createSidebarActiveChat(item.sourceName, item.sourceId ?? globalChatIds[item.sourceName]))}
                      onTogglePin={() => toggleGlobalPin('chat', item.sourceName, item.sourceId ?? globalChatIds[item.sourceName])}
                      onCreateChat={createSidebarChat}
                      key={item.id}
                    />
                  )
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <SectionHeader
            title="项目"
            showMore
            createLabel="新建项目"
            onCreate={createSidebarProject}
            expanded={openSections.projects}
            onToggle={() => toggleSection('projects')}
          />
          <AnimatePresence initial={false}>
            {openSections.projects ? (
              <motion.div
                className="project-list collapsible-section"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                {projectItems
                  .filter((project) => !isGlobalPinned('project', project.name, project.id))
                  .map((project, projectIndex) => (
                    <ProjectBlock
                      project={project}
                      isPinned={isGlobalPinned('project', project.name, project.id)}
                      activeChatId={activeChatId}
                      onOpenChat={onOpenChat}
                      onCreateChat={createProjectChat}
                      onTogglePin={() => toggleGlobalPin('project', project.name, project.id)}
                      onToggleChatPin={toggleProjectChatPin}
                      key={`${project.id ?? project.name}:${projectIndex}`}
                    />
                  ))}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <SectionHeader
            title="会话"
            showMore
            createLabel="新建会话"
            createIcon={MessageSquarePlus}
            onCreate={createSidebarChat}
            expanded={openSections.chats}
            onToggle={() => toggleSection('chats')}
          />
          <AnimatePresence initial={false}>
            {openSections.chats ? (
              <motion.div
                className="list-group collapsible-section"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                {chatItems
                  .filter((chat) => !isGlobalPinned('chat', chat, globalChatIds[chat]))
                  .map((chat, chatIndex) => (
                    <SidebarChatRow
                      chat={chat}
                      pinned={isGlobalPinned('chat', chat, globalChatIds[chat])}
                      active={activeChatId === getSidebarChatId(globalChatIds[chat] ?? chat)}
                      onOpenChat={() => onOpenChat(createSidebarActiveChat(chat, globalChatIds[chat]))}
                      onTogglePin={() => toggleGlobalPin('chat', chat, globalChatIds[chat])}
                      onCreateChat={createSidebarChat}
                      key={`${globalChatIds[chat] ?? chat}:${chatIndex}`}
                    />
                  ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="sidebar-footer">
          <button className="footer-split" type="button" aria-label="??" onClick={onOpenSettings}>
            <Settings size={16} />
          </button>
          <button className="footer-split sync-button" type="button" aria-label="手机电脑双向同步">
            <Smartphone size={15} />
            <ChevronsLeftRight size={15} />
            <Laptop size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function PluginsWorkspace() {
  const [activeTab, setActiveTab] = useState(pluginTabs[0])

  return (
    <main className="plugins-workspace" aria-label="Plugins">
      <section className="plugins-workspace-shell">
        <header className="plugins-topbar">
          <nav className="plugins-tabs" aria-label="Plugin sections">
            {pluginTabs.map((tab) => (
              <button
                className={activeTab === tab ? 'plugins-tab active' : 'plugins-tab'}
                type="button"
                onClick={() => setActiveTab(tab)}
                key={tab}
              >
                {tab}
              </button>
            ))}
          </nav>
        </header>
        <div className="plugins-coming-soon">
          <PackagePlus size={30} strokeWidth={1.7} />
          <h1>{"\u656c\u8bf7\u671f\u5f85"}</h1>
        </div>
      </section>
    </main>
  )
}

function McpSettingsContent() {
  const [enabledServers, setEnabledServers] = useState<Set<string>>(() => new Set(mcpServerPlaceholders))

  const toggleServer = (server: string) => {
    setEnabledServers((currentServers) => {
      const nextServers = new Set(currentServers)

      if (nextServers.has(server)) {
        nextServers.delete(server)
      } else {
        nextServers.add(server)
      }

      return nextServers
    })
  }

  return (
    <div className="settings-mcp-content">
      <div className="settings-mcp-header">
        <h1>MCP 服务器</h1>
        <p>
          连接外部工具和数据源。
          <a href="#" onClick={(event) => event.preventDefault()}>
            了解更多。
          </a>
        </p>
      </div>

      <section className="settings-mcp-section" aria-label="MCP servers">
        <div className="settings-mcp-section-header">
          <h2>服务器</h2>
          <button className="settings-mcp-add" type="button">
            <Plus size={15} />
            <span>添加服务器</span>
          </button>
        </div>

        <div className="settings-mcp-table">
          {mcpServerPlaceholders.map((server) => {
            const enabled = enabledServers.has(server)

            return (
              <div className="settings-mcp-row" key={server}>
                <span className="settings-mcp-name">{server}</span>
                <div className="settings-mcp-row-actions">
                  <button className="settings-mcp-gear" type="button" aria-label={`${server} 设置`}>
                    <Settings size={15} />
                  </button>
                  <button
                    className={`settings-mcp-switch ${enabled ? 'checked' : ''}`}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? '禁用' : '启用'} ${server}`}
                    onClick={() => toggleServer(server)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function SettingsWorkspace({ activeSetting }: { activeSetting: string }) {
  return (
    <main className="settings-workspace" aria-label="Settings">
      <section className={`settings-workspace-shell ${activeSetting === 'mcp' ? 'mcp-settings-shell' : ''}`}>
        {activeSetting === 'mcp' ? (
          <McpSettingsContent />
        ) : (
          <div className="settings-coming-soon">
            <Settings size={28} strokeWidth={1.7} />
            <h1>{"\u656c\u8bf7\u671f\u5f85"}</h1>
          </div>
        )}
      </section>
    </main>
  )
}

function SlashCommandMenu({
  state,
  onSelectCommand,
}: {
  state: SlashMenuState
  onSelectCommand: (item: SlashCommandItem) => void
}) {
  const showSkills = state.skills.length > 0

  return (
    <motion.div
      className="slash-command-menu"
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.985 }}
      transition={{ duration: 0.18 }}
    >
      <div className="menu-sheen" />
      <div className="slash-command-scroll" role="listbox" aria-label="斜杠菜单">
        {state.commands.map((item) => {
          const Icon = item.icon

          return (
            <button className="slash-command-row" type="button" key={item.label} onClick={() => onSelectCommand(item)}>
              <span className="slash-command-icon">
                <Icon size={15} />
              </span>
              <span className="slash-command-copy">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
            </button>
          )
        })}

        {showSkills ? <div className="slash-section-title">技能</div> : null}

        {state.skills.map((skill) => (
          <button className="slash-command-row slash-skill-row" type="button" key={skill}>
            <span className="slash-command-icon">
              <PackagePlus size={15} />
            </span>
            <span className="slash-command-copy">
              <strong>{skill}</strong>
              <span>Skill 占位</span>
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

function AttachMenu({
  onSelectGoal,
  onSelectFile,
  onSelectFolder,
}: {
  onSelectGoal: () => void
  onSelectFile: () => void
  onSelectFolder: () => void
}) {
  const selectAction = (item: AttachActionItem) => {
    if (item.id === 'goal') {
      onSelectGoal()
    } else if (item.id === 'file') {
      onSelectFile()
    } else if (item.id === 'folder') {
      onSelectFolder()
    }
  }

  return (
    <motion.div
      className="attach-menu"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.18 }}
    >
      <div className="menu-sheen" />
      {attachActions.map((item) => {
        const Icon = item.icon

        return (
          <button
            className="attach-item"
            type="button"
            key={item.label}
            onClick={() => selectAction(item)}
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </motion.div>
  )
}

function ApprovalMenu({
  open,
  onModeChange,
}: {
  open: boolean
  onModeChange: (mode: string) => void
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="approval-menu"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.16 }}
        >
          {approvalModes.map((mode) => (
            <button type="button" className="approval-option" key={mode.id} onClick={() => onModeChange(mode.id)}>
              {mode.label}
            </button>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function ModelMenu({
  query,
  selectedModel,
  modelGroups,
  onQueryChange,
  onSelectModel,
  onAddModel,
  onManageModels,
}: {
  query: string
  selectedModel: string
  modelGroups: ModelGroup[]
  onQueryChange: (query: string) => void
  onSelectModel: (model: string) => void
  onAddModel: () => void
  onManageModels: () => void
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredGroups = modelGroups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        normalizedQuery ? matchesSlashQuery(`${group.provider} ${model}`, normalizedQuery) : true,
      ),
    }))
    .filter((group) => group.models.length > 0)

  return (
    <motion.div
      className="model-menu"
      role="dialog"
      aria-label={"\u9009\u62e9\u6a21\u578b"}
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.985 }}
      transition={{ duration: 0.17 }}
    >
      <div className="menu-sheen" />
      <div className="model-menu-toolbar">
        <label className="model-search">
          <Search size={15} />
          <input
            aria-label={"\u641c\u7d22\u6a21\u578b"}
            placeholder={"\u641c\u7d22\u6a21\u578b"}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <button className="model-icon-button" type="button" aria-label={"\u6dfb\u52a0\u6a21\u578b"} onClick={onAddModel}>
          <Plus size={16} />
        </button>
        <button className="model-icon-button" type="button" aria-label={"\u6a21\u578b\u8bbe\u7f6e"} onClick={onManageModels}>
          <SlidersHorizontal size={16} />
        </button>
      </div>

      <div className="model-menu-scroll" role="listbox" aria-label={"\u6a21\u578b\u5217\u8868"}>
        {filteredGroups.length > 0 ? (
          filteredGroups.map((group) => (
            <div className="model-group" key={group.provider}>
              <div className="model-group-title">{group.provider}</div>
              {group.models.map((model) => {
                const selected = selectedModel === model

                return (
                  <button
                    className={`model-option ${selected ? 'selected' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    key={model}
                    onClick={() => onSelectModel(model)}
                  >
                    <span>{model}</span>
                    {selected ? <Check size={14} /> : null}
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          <div className="model-empty">{"\u6ca1\u6709\u5339\u914d\u6a21\u578b"}</div>
        )}
      </div>
    </motion.div>
  )
}

function ModelManageDialog({
  open,
  modelGroups,
  visibleModelKeys,
  onClose,
  onToggleModel,
  onConnectProvider,
}: {
  open: boolean
  modelGroups: ModelGroup[]
  visibleModelKeys: Set<string> | null
  onClose: () => void
  onToggleModel: (provider: string, model: string) => void
  onConnectProvider: () => void
}) {
  const [query, setQuery] = useState('')

  if (typeof document === 'undefined') {
    return null
  }

  const allKeys = visibleModelKeys ?? new Set(modelVisibilityKeys(modelGroups))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredGroups = modelGroups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        normalizedQuery ? matchesSlashQuery(`${group.provider} ${model}`, normalizedQuery) : true,
      ),
    }))
    .filter((group) => group.models.length > 0)

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="model-manage-layer"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <motion.div
            className="model-manage-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="管理模型"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="model-manage-header">
              <div>
                <h2>管理模型</h2>
                <p>自定义模型选择器中显示的模型。</p>
              </div>
              <div className="model-manage-actions">
                <button className="model-manage-provider" type="button" onClick={onConnectProvider}>
                  <Plus size={14} />
                  <span>连接提供商</span>
                </button>
                <button className="model-manage-close" type="button" aria-label="关闭" onClick={onClose}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <label className="model-manage-search">
              <Search size={16} />
              <input
                aria-label="搜索模型"
                placeholder="搜索模型"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="model-manage-list">
              {filteredGroups.length > 0 ? (
                filteredGroups.map((group) => (
                  <section className="model-manage-group" key={group.provider}>
                    <h3>{group.provider}</h3>
                    {group.models.map((model) => {
                      const checked = allKeys.has(modelVisibilityKey(group.provider, model))

                      return (
                        <button
                          className="model-manage-row"
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          key={model}
                          onClick={() => onToggleModel(group.provider, model)}
                        >
                          <span>{model}</span>
                          <span className={`model-switch ${checked ? 'checked' : ''}`} aria-hidden="true">
                            <span />
                          </span>
                        </button>
                      )
                    })}
                  </section>
                ))
              ) : (
                <div className="model-manage-empty">没有匹配模型</div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

type ProviderFormState = {
  id: string
  name: string
  baseURL: string
  apiKey: string
  apiKeyEnvText: string
  modelsText: string
  enabled: boolean
}

const providerIconForId = (id: string): IconType => {
  if (id.includes('openrouter')) return ExternalLink
  if (id.includes('vercel')) return PackagePlus
  if (id.includes('deepseek')) return Sparkles
  if (id.includes('minimax')) return Bot
  if (id.includes('google')) return Sparkles
  if (id.includes('openai')) return Sparkles
  if (id.includes('custom')) return SlidersHorizontal
  if (id.includes('302')) return Bot
  if (id.includes('aihub')) return Gauge
  return Activity
}

const splitProviderLines = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const providerFormFromConnection = (provider?: UiProviderConnection): ProviderFormState => ({
  id: provider?.id ?? 'custom',
  name: provider?.name ?? 'Custom',
  baseURL: provider?.baseURL ?? '',
  apiKey: '',
  apiKeyEnvText: provider?.apiKeyEnv?.join(', ') ?? '',
  modelsText: provider?.models?.join('\n') ?? 'custom-model',
  enabled: provider?.enabled !== false,
})

const providerMatchesQuery = (provider: UiProviderConnection, query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true

  return matchesSlashQuery(
    [provider.name, provider.id, provider.description, provider.baseURL, provider.models.join(' ')].join(' '),
    normalizedQuery,
  )
}

function ProviderConnectDialog({
  open,
  onClose,
  onProvidersChanged,
}: {
  open: boolean
  onClose: () => void
  onProvidersChanged?: () => void
}) {
  const [providers, setProviders] = useState<UiProviderConnection[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [form, setForm] = useState<ProviderFormState>(() => providerFormFromConnection())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | undefined>()
  const activeProvider = providers.find((provider) => provider.id === selectedId) ?? providers[0]

  useEffect(() => {
    if (!open) return

    let alive = true
    setLoading(true)
    setStatus(undefined)
    void loadProviderConnections()
      .then((rows) => {
        if (!alive) return
        const nextProviders = rows ?? []
        setProviders(nextProviders)
        const nextSelected = selectedId && nextProviders.some((provider) => provider.id === selectedId)
          ? selectedId
          : nextProviders[0]?.id
        setSelectedId(nextSelected)
        setForm(providerFormFromConnection(nextProviders.find((provider) => provider.id === nextSelected)))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open || !activeProvider) return
    setForm(providerFormFromConnection(activeProvider))
    setStatus(undefined)
  }, [open, activeProvider?.id])

  if (typeof document === 'undefined') {
    return null
  }

  const providerGroupsForView = [
    {
      title: '热门',
      providers: providers.filter((provider) => provider.popular && providerMatchesQuery(provider, query)),
    },
    {
      title: '其他',
      providers: providers.filter((provider) => !provider.popular && providerMatchesQuery(provider, query)),
    },
  ].filter((group) => group.providers.length > 0)

  const updateForm = (key: keyof ProviderFormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }))
    setStatus(undefined)
  }

  const reloadProviders = async (selectedProviderId?: string) => {
    const rows = (await loadProviderConnections()) ?? []
    setProviders(rows)
    if (selectedProviderId) {
      setSelectedId(selectedProviderId)
      setForm(providerFormFromConnection(rows.find((provider) => provider.id === selectedProviderId)))
    }
    onProvidersChanged?.()
  }

  const saveConnection = async () => {
    if (saving) return
    const models = splitProviderLines(form.modelsText)
    const apiKeyEnv = splitProviderLines(form.apiKeyEnvText)

    if (!form.id.trim() || !form.name.trim()) {
      setStatus('Provider ID 和显示名称不能为空。')
      return
    }
    if (activeProvider?.requiresBaseURL && !form.baseURL.trim()) {
      setStatus('这个提供商需要填写 Base URL。')
      return
    }
    if (models.length === 0) {
      setStatus('至少需要保留一个模型。')
      return
    }

    setSaving(true)
    try {
      const saved = await saveProviderConnection({
        id: form.id,
        name: form.name,
        baseURL: form.baseURL,
        models,
        apiKey: form.apiKey,
        apiKeyEnv,
        enabled: form.enabled,
        custom: activeProvider?.custom,
        requiresBaseURL: activeProvider?.requiresBaseURL,
      })
      if (!saved) {
        setStatus('保存失败，请检查后端状态。')
        return
      }
      setStatus(saved.connected ? '已保存并连接。' : '已保存，等待 API Key 或环境变量。')
      await reloadProviders(saved.id)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const disconnectConnection = async () => {
    if (!activeProvider || saving) return
    setSaving(true)
    try {
      const ok = await deleteProviderConnection(activeProvider.id)
      setStatus(ok ? '已断开连接。' : '断开失败。')
      await reloadProviders(activeProvider.id)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="provider-dialog-layer"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
        >
          <motion.div
            className="provider-dialog provider-dialog-real"
            role="dialog"
            aria-modal="true"
            aria-label="连接提供商"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="provider-dialog-header">
              <div>
                <h2>连接提供商</h2>
                <p>管理模型提供商、API Key、Base URL 和可用模型。</p>
              </div>
              <button className="provider-dialog-close" type="button" aria-label="关闭" onClick={onClose}>
                <X size={16} />
              </button>
            </div>

            <div className="provider-dialog-body">
              <div className="provider-picker-pane">
                <label className="provider-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索提供商"
                    placeholder="搜索提供商"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>

                <div className="provider-list provider-list-real">
                  {loading ? <div className="provider-empty">正在加载提供商...</div> : null}
                  {!loading && providerGroupsForView.length === 0 ? <div className="provider-empty">没有匹配的提供商</div> : null}
                  {providerGroupsForView.map((group) => (
                    <section className="provider-group" key={group.title}>
                      <h3>{group.title}</h3>
                      {group.providers.map((provider) => {
                        const ProviderIcon = providerIconForId(provider.id)
                        const selected = activeProvider?.id === provider.id

                        return (
                          <button
                            className={'provider-option ' + (selected ? 'selected' : '')}
                            type="button"
                            key={provider.id}
                            onClick={() => setSelectedId(provider.id)}
                          >
                            <span className="provider-option-icon">
                              <ProviderIcon size={15} />
                            </span>
                            <span className="provider-option-copy">
                              <span className="provider-option-title">
                                {provider.name}
                                {provider.custom ? <span className="provider-option-tag">自定义</span> : null}
                                {provider.connected ? <span className="provider-option-tag connected">已连接</span> : null}
                              </span>
                              <span className="provider-option-description">{provider.description}</span>
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  ))}
                </div>
              </div>

              <div className="provider-config-pane">
                {activeProvider ? (
                  <>
                    <div className="provider-config-head">
                      <div className="provider-config-icon" aria-hidden="true">
                        {(() => {
                          const ProviderIcon = providerIconForId(activeProvider.id)
                          return <ProviderIcon size={18} />
                        })()}
                      </div>
                      <div>
                        <h3>{activeProvider.name}</h3>
                        <p>{activeProvider.connected ? '\u5f53\u524d\u63d0\u4f9b\u5546\u5df2\u7ecf\u53ef\u7528\u4e8e\u6a21\u578b\u9009\u62e9\u3002' : '\u586b\u5199 API Key \u6216\u73af\u5883\u53d8\u91cf\u540e\u5373\u53ef\u8fde\u63a5\u3002'}</p>
                      </div>
                    </div>

                    <div className="provider-status-row">
                      <span className={'provider-status-pill ' + (activeProvider.connected ? 'connected' : '')}>
                        {activeProvider.connected ? 'Connected' : 'Not connected'}
                      </span>
                      <button
                        className={'provider-enable-switch ' + (form.enabled ? 'enabled' : '')}
                        type="button"
                        role="switch"
                        aria-checked={form.enabled}
                        onClick={() => updateForm('enabled', !form.enabled)}
                      >
                        <span />
                      </button>
                    </div>

                    <div className="provider-form-grid">
                      <label className="provider-field">
                        <span>Provider ID</span>
                        <input
                          value={form.id}
                          readOnly={!activeProvider.custom}
                          onChange={(event) => updateForm('id', event.target.value)}
                        />
                      </label>
                      <label className="provider-field">
                        <span>显示名称</span>
                        <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
                      </label>
                      <label className="provider-field provider-field-wide">
                        <span>Base URL</span>
                        <input
                          value={form.baseURL}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) => updateForm('baseURL', event.target.value)}
                        />
                      </label>
                      <label className="provider-field provider-field-wide">
                        <span>API Key</span>
                        <input
                          type="password"
                          value={form.apiKey}
                          placeholder={activeProvider.apiKeySet ? '已保存，留空保持不变' : 'sk-...'}
                          onChange={(event) => updateForm('apiKey', event.target.value)}
                        />
                      </label>
                      <label className="provider-field provider-field-wide">
                        <span>环境变量</span>
                        <input
                          value={form.apiKeyEnvText}
                          placeholder="OPENAI_API_KEY"
                          onChange={(event) => updateForm('apiKeyEnvText', event.target.value)}
                        />
                      </label>
                      <label className="provider-field provider-field-wide">
                        <span>模型列表</span>
                        <textarea
                          value={form.modelsText}
                          rows={5}
                          onChange={(event) => updateForm('modelsText', event.target.value)}
                        />
                      </label>
                    </div>

                    {status ? <div className="provider-save-status">{status}</div> : null}

                    <div className="provider-config-actions">
                      <button className="provider-secondary-action" type="button" onClick={disconnectConnection} disabled={saving}>
                        断开
                      </button>
                      <button className="provider-primary-action" type="button" onClick={saveConnection} disabled={saving}>
                        {saving ? '保存中...' : '保存连接'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="provider-empty provider-empty-panel">请选择一个提供商</div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

const isAgentEventRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const agentEventRecord = (event: AgentRunEvent, key: string): Record<string, unknown> | undefined => {
  const value = event[key]

  return isAgentEventRecord(value) ? value : undefined
}

const agentEventString = (source: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = source?.[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

const agentEventNumber = (source: Record<string, unknown> | undefined, key: string): number | undefined => {
  const value = source?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const previewEventValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim() || undefined
  }

  if (value === undefined || value === null) {
    return undefined
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 900)
  } catch {
    return String(value).slice(0, 900)
  }
}

const getAgentRunEventType = (event: AgentRunEvent) =>
  agentEventString(event, 'type') ?? agentEventString(event, 'event')

const getApprovalEventId = (event: AgentRunEvent) => {
  const request = agentEventRecord(event, 'request')

  return agentEventString(event, 'approvalId') ?? agentEventString(request, 'approvalId') ?? agentEventString(event, 'id')
}

const normalizePendingApproval = (event: AgentRunEvent): PendingApprovalItem | null => {
  const type = getAgentRunEventType(event)
  if (type !== 'approval_pending' && type !== 'approval_requested') {
    return null
  }

  const request = agentEventRecord(event, 'request')
  const approvalId = getApprovalEventId(event)

  if (!approvalId) {
    return null
  }

  const inputPreview =
    previewEventValue(request?.input) ??
    previewEventValue(request?.arguments) ??
    previewEventValue(request?.command) ??
    previewEventValue(request?.preview)

  return {
    id: approvalId,
    threadId: agentEventString(event, 'threadId') ?? agentEventString(request, 'threadId'),
    toolName:
      agentEventString(request, 'toolName') ??
      agentEventString(request, 'tool') ??
      agentEventString(event, 'toolName') ??
      agentEventString(event, 'tool') ??
      'tool',
    reason: agentEventString(request, 'reason') ?? agentEventString(event, 'reason'),
    risk: agentEventString(request, 'risk') ?? agentEventString(event, 'risk'),
    safety: agentEventString(request, 'safety') ?? agentEventString(event, 'safety'),
    sandboxMode: agentEventString(request, 'sandboxMode') ?? agentEventString(event, 'sandboxMode'),
    approvalPolicy: agentEventString(request, 'approvalPolicy') ?? agentEventString(event, 'approvalPolicy'),
    inputPreview,
    createdAtMs: agentEventNumber(event, 'createdAtMs') ?? agentEventNumber(request, 'createdAtMs'),
    status: 'pending',
  }
}

const agentEventBoolean = (source: Record<string, unknown> | undefined, key: string): boolean | undefined => {
  const value = source?.[key]

  return typeof value === 'boolean' ? value : undefined
}

const agentEventArray = (source: Record<string, unknown> | undefined, key: string): unknown[] | undefined => {
  const value = source?.[key]

  return Array.isArray(value) ? value : undefined
}

const activityTime = (event: AgentRunEvent) => agentEventNumber(event, 'createdAtMs') ?? Date.now()

const activityRunScope = (event: AgentRunEvent) =>
  agentEventString(event, 'runId') ?? agentEventString(event, 'sessionId') ?? agentEventString(event, 'turnId') ?? 'live'

const activityDetail = (event: AgentRunEvent, keys: string[]) => {
  const details = keys.flatMap((key) => {
    const value = event[key]
    const preview = previewEventValue(value)

    return preview ? [`${key}: ${preview}`] : []
  })

  return details.length > 0 ? details.join('\n') : undefined
}

const usageTotalTokens = (usage: Record<string, unknown> | undefined) => {
  const directTotal =
    agentEventNumber(usage, 'total_tokens') ??
    agentEventNumber(usage, 'totalTokens') ??
    agentEventNumber(usage, 'total') ??
    agentEventNumber(usage, 'total_token_count')

  if (directTotal !== undefined) {
    return directTotal
  }

  const inputTokens =
    agentEventNumber(usage, 'input_tokens') ??
    agentEventNumber(usage, 'inputTokens') ??
    agentEventNumber(usage, 'prompt_tokens') ??
    agentEventNumber(usage, 'promptTokens')
  const outputTokens =
    agentEventNumber(usage, 'output_tokens') ??
    agentEventNumber(usage, 'outputTokens') ??
    agentEventNumber(usage, 'completion_tokens') ??
    agentEventNumber(usage, 'completionTokens')

  return inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined
}

const usageContextWindowTokens = (usage: Record<string, unknown> | undefined) =>
  agentEventNumber(usage, 'contextWindowTokens') ??
  agentEventNumber(usage, 'context_window_tokens') ??
  agentEventNumber(usage, 'model_context_window')

const extractContextUsageFromEvent = (
  event: AgentRunEvent,
  currentUsage: ContextUsage | undefined,
): ContextUsage | undefined => {
  const tokenBudget = agentEventRecord(event, 'tokenBudget')
  const createdAtMs = activityTime(event)

  if (tokenBudget && agentEventBoolean(tokenBudget, 'enabled') !== false) {
    const contextWindowTokens = agentEventNumber(tokenBudget, 'contextWindowTokens') ?? currentUsage?.totalTokens
    const maxInputTokens = agentEventNumber(tokenBudget, 'maxInputTokens')
    const reserveOutputTokens = agentEventNumber(tokenBudget, 'reserveOutputTokens')
    const estimatedTokensLeft = agentEventNumber(tokenBudget, 'estimatedTokensLeft')
    const estimatedInputTokens =
      agentEventNumber(tokenBudget, 'estimatedInputTokens') ??
      (maxInputTokens !== undefined && estimatedTokensLeft !== undefined ? maxInputTokens - estimatedTokensLeft : undefined)
    const totalTokens =
      contextWindowTokens ??
      (maxInputTokens !== undefined && reserveOutputTokens !== undefined ? maxInputTokens + reserveOutputTokens : undefined)

    return createContextUsage({
      usedTokens: estimatedInputTokens,
      totalTokens,
      estimated: true,
      source: 'token_budget',
      updatedAtMs: createdAtMs,
    })
  }

  const usage = agentEventRecord(event, 'usage')
  const totalUsageTokens = usageTotalTokens(usage)

  if (totalUsageTokens !== undefined) {
    return createContextUsage({
      usedTokens: totalUsageTokens,
      totalTokens: usageContextWindowTokens(usage) ?? currentUsage?.totalTokens,
      estimated: false,
      source: 'model_usage',
      updatedAtMs: createdAtMs,
    })
  }

  if (getAgentRunEventType(event) === 'context_built') {
    const estimatedChars = agentEventNumber(event, 'estimatedChars')
    const maxContextChars = agentEventNumber(event, 'maxContextChars')

    if (estimatedChars !== undefined || maxContextChars !== undefined) {
      return createContextUsage({
        usedTokens: estimatedChars !== undefined ? Math.ceil(estimatedChars / DEFAULT_CONTEXT_CHARS_PER_TOKEN) : undefined,
        totalTokens: maxContextChars !== undefined ? Math.ceil(maxContextChars / DEFAULT_CONTEXT_CHARS_PER_TOKEN) : currentUsage?.totalTokens,
        estimated: true,
        source: 'char_estimate',
        updatedAtMs: createdAtMs,
      })
    }
  }

  return undefined
}

const deriveContextUsageFromEvents = (events: AgentRunEvent[] | undefined) =>
  (events ?? []).reduce<ContextUsage | undefined>((usage, event) => extractContextUsageFromEvent(event, usage) ?? usage, undefined)

const compactActivityPreview = (value: string | undefined, maxChars = 180) => {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1)}...` : compact
}

const getToolEventId = (event: AgentRunEvent) =>
  agentEventString(event, 'toolUseId') ??
  agentEventString(event, 'toolCallId') ??
  agentEventString(event, 'callId') ??
  agentEventString(event, 'id')

const getToolEventName = (event: AgentRunEvent) =>
  agentEventString(event, 'toolName') ??
  agentEventString(event, 'tool') ??
  agentEventString(event, 'name') ??
  'tool'

const getApprovalStatus = (event: AgentRunEvent): ActivityStatus => {
  const decision = agentEventString(event, 'decision')
  const approved = agentEventBoolean(event, 'approved')

  if (decision === 'reject' || approved === false) return 'rejected'
  return 'approved'
}

const normalizeGoalEventSummary = (event: AgentRunEvent): UiGoalSummary | undefined => {
  const goal = agentEventRecord(event, 'goal')
  if (!goal) return undefined
  const id = agentEventString(goal, 'goalId') ?? agentEventString(goal, 'id') ?? agentEventString(goal, 'threadId')
  const objective = agentEventString(goal, 'objective') ?? agentEventString(goal, 'title')
  const title = agentEventString(goal, 'title') ?? objective ?? id
  if (!id || !objective || !title) return undefined
  const rawStatus = agentEventString(goal, 'status') ?? 'active'
  const status =
    rawStatus === 'paused' || rawStatus === 'blocked' || rawStatus === 'usageLimited' || rawStatus === 'budgetLimited' || rawStatus === 'complete'
      ? rawStatus
      : rawStatus === 'usage_limited'
        ? 'usageLimited'
        : rawStatus === 'budget_limited'
          ? 'budgetLimited'
          : rawStatus === 'completed'
            ? 'complete'
            : 'active'

  return {
    id,
    goalId: agentEventString(goal, 'goalId') ?? id,
    threadId: agentEventString(goal, 'threadId'),
    title,
    objective,
    status,
    tokenBudget: agentEventNumber(goal, 'tokenBudget'),
    tokensUsed: agentEventNumber(goal, 'tokensUsed'),
    timeUsedSeconds: agentEventNumber(goal, 'timeUsedSeconds'),
    progressPercent: agentEventNumber(goal, 'progressPercent') ?? 0,
    requirementCount: agentEventNumber(goal, 'requirementCount') ?? 0,
    completedRequirementCount: agentEventNumber(goal, 'completedRequirementCount') ?? 0,
    blockerCount: agentEventNumber(goal, 'blockerCount') ?? 0,
    updatedAtMs: agentEventNumber(goal, 'updatedAtMs'),
  }
}

const normalizeActivityPart = (event: AgentRunEvent, sequence: number): ActivityPart | null => {
  const type = getAgentRunEventType(event)
  const createdAtMs = activityTime(event)
  const scope = activityRunScope(event)
  const fallbackId = `${scope}:${type ?? 'event'}:${sequence}`

  if (type === 'turn_started') {
    return {
      id: `turn:${agentEventString(event, 'turnId') ?? scope}`,
      kind: 'turn',
      status: 'running',
      title: 'Turn started',
      summary: compactActivityPreview(agentEventString(event, 'promptPreview')) ?? 'The agent started this turn.',
      startedAtMs: createdAtMs,
    }
  }

  if (type === 'turn_completed') {
    return {
      id: `turn:${agentEventString(event, 'turnId') ?? scope}`,
      kind: 'turn',
      status: 'completed',
      title: 'Turn completed',
      summary: agentEventNumber(event, 'durationMs') !== undefined ? `${(agentEventNumber(event, 'durationMs')! / 1000).toFixed(1)}s` : 'The turn completed.',
      completedAtMs: createdAtMs,
      outputPreview: compactActivityPreview(agentEventString(event, 'finalTextPreview')),
    }
  }

  if (type === 'turn_failed' || type === 'run_failed' || type === 'web_chat_failed' || type === 'web_goal_failed') {
    return {
      id: `error:${scope}:${sequence}`,
      kind: 'error',
      status: 'failed',
      title: type === 'turn_failed' ? 'Turn failed' : 'Run failed',
      summary: compactActivityPreview(agentEventString(event, 'message') ?? agentEventString(event, 'error')) ?? 'The run failed.',
      detail: activityDetail(event, ['message', 'error', 'durationMs']),
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'context_built') {
    const retained = agentEventNumber(event, 'retainedMessageCount')
    const source = agentEventNumber(event, 'sourceMessageCount')

    return {
      id: `context:${agentEventString(event, 'turnId') ?? scope}`,
      kind: 'context',
      status: 'completed',
      title: 'Built context',
      summary: retained !== undefined && source !== undefined ? `retained ${retained} / ${source}` : 'Context was prepared.',
      detail: activityDetail(event, [
        'sourceMessageCount',
        'retainedMessageCount',
        'droppedMessageCount',
        'estimatedChars',
        'maxContextChars',
        'compactionSummaryIncluded',
      ]),
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'model_request_started') {
    const provider = agentEventString(event, 'provider')
    const model = agentEventString(event, 'model')
    const round = agentEventNumber(event, 'round')

    return {
      id: `model:${scope}:${round ?? 'request'}`,
      kind: 'model',
      status: 'running',
      title: 'Calling model',
      summary: [provider, model].filter(Boolean).join(' · ') || 'Model request started.',
      detail: activityDetail(event, ['provider', 'model', 'round', 'toolCount']),
      startedAtMs: createdAtMs,
    }
  }

  if (type === 'model_response_completed') {
    const provider = agentEventString(event, 'provider')
    const model = agentEventString(event, 'model')
    const round = agentEventNumber(event, 'round')
    const toolCalls = agentEventArray(event, 'toolCalls') ?? []

    return {
      id: `model:${scope}:${round ?? 'request'}`,
      kind: 'model',
      status: 'completed',
      title: 'Model response completed',
      summary: toolCalls.length > 0 ? `requested ${toolCalls.length} tool call(s)` : ([provider, model].filter(Boolean).join(' · ') || 'Model response completed.'),
      detail: activityDetail(event, ['textPreview', 'toolCalls', 'usage']),
      outputPreview: compactActivityPreview(agentEventString(event, 'textPreview')),
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'tool_call_started') {
    const toolCallId = getToolEventId(event)
    const toolName = getToolEventName(event)

    return {
      id: `tool:${toolCallId ?? fallbackId}`,
      kind: 'tool',
      status: 'running',
      title: `Running ${toolName}`,
      summary: compactActivityPreview(previewEventValue(event.input)) ?? 'Tool call started.',
      detail: activityDetail(event, ['toolName', 'safety', 'input']),
      toolCallId,
      inputPreview: compactActivityPreview(previewEventValue(event.input), 260),
      startedAtMs: createdAtMs,
    }
  }

  if (type === 'tool_result') {
    const toolCallId = getToolEventId(event)
    const toolName = getToolEventName(event)
    const ok = agentEventBoolean(event, 'ok')

    return {
      id: `tool:${toolCallId ?? fallbackId}`,
      kind: 'tool',
      status: ok === false ? 'failed' : 'completed',
      title: `${toolName} result`,
      summary: compactActivityPreview(agentEventString(event, 'contentPreview')) ?? (ok === false ? 'Tool failed.' : 'Tool returned a result.'),
      detail: activityDetail(event, ['contentPreview', 'metadata']),
      toolCallId,
      outputPreview: compactActivityPreview(agentEventString(event, 'contentPreview'), 260),
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'tool_call_completed') {
    const toolCallId = getToolEventId(event)
    const toolName = getToolEventName(event)
    const ok = agentEventBoolean(event, 'ok')
    const durationMs = agentEventNumber(event, 'durationMs')

    return {
      id: `tool:${toolCallId ?? fallbackId}`,
      kind: 'tool',
      status: ok === false ? 'failed' : 'completed',
      title: `${toolName} ${ok === false ? 'failed' : 'completed'}`,
      summary: compactActivityPreview(agentEventString(event, 'contentPreview')) ?? (durationMs !== undefined ? `${(durationMs / 1000).toFixed(1)}s` : 'Tool call completed.'),
      detail: activityDetail(event, ['contentPreview', 'metadata', 'durationMs']),
      toolCallId,
      outputPreview: compactActivityPreview(agentEventString(event, 'contentPreview'), 260),
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'approval_pending' || type === 'approval_requested') {
    const approval = normalizePendingApproval(event)
    if (!approval) return null

    return {
      id: `approval:${approval.id}`,
      kind: 'approval',
      status: 'waiting_approval',
      title: `Waiting for approval: ${approval.toolName}`,
      summary: approval.reason ?? approval.safety ?? 'Approval is required before this action can continue.',
      detail: [approval.inputPreview, approval.risk, approval.sandboxMode, approval.approvalPolicy].filter(Boolean).join('\n') || undefined,
      approvalId: approval.id,
      inputPreview: compactActivityPreview(approval.inputPreview, 260),
      startedAtMs: approval.createdAtMs ?? createdAtMs,
    }
  }

  if (type === 'approval_answered' || type === 'approval_completed') {
    const approvalId = getApprovalEventId(event)
    if (!approvalId) return null
    const status = getApprovalStatus(event)

    return {
      id: `approval:${approvalId}`,
      kind: 'approval',
      status,
      title: status === 'rejected' ? 'Approval rejected' : 'Approval approved',
      summary: agentEventString(event, 'reason') ?? agentEventString(event, 'decision') ?? (status === 'rejected' ? 'The request was rejected.' : 'The request was approved.'),
      detail: activityDetail(event, ['decision', 'reason', 'resolvedBy']),
      approvalId,
      completedAtMs: createdAtMs,
    }
  }

  if (type === 'gui_action_started') {
    const guiActionId = agentEventString(event, 'guiActionId') ?? agentEventString(event, 'id')

    return {
      id: `gui:${guiActionId ?? fallbackId}`,
      kind: 'gui',
      status: 'running',
      title: 'GUI action started',
      summary: agentEventString(event, 'action') ?? agentEventString(event, 'method') ?? 'The agent is operating the GUI.',
      detail: activityDetail(event, ['action', 'target', 'text', 'keys', 'method']),
      startedAtMs: createdAtMs,
    }
  }

  if (type === 'gui_action_completed' || type === 'gui_action_failed') {
    const guiActionId = agentEventString(event, 'guiActionId') ?? agentEventString(event, 'id')
    const failed = type === 'gui_action_failed' || agentEventBoolean(event, 'ok') === false

    return {
      id: `gui:${guiActionId ?? fallbackId}`,
      kind: 'gui',
      status: failed ? 'failed' : 'completed',
      title: failed ? 'GUI action failed' : 'GUI action completed',
      summary: compactActivityPreview(agentEventString(event, 'message') ?? agentEventString(event, 'method')) ?? 'GUI action finished.',
      detail: activityDetail(event, ['message', 'method', 'screenshotPath', 'fallbackUsed']),
      outputPreview: compactActivityPreview(agentEventString(event, 'message'), 260),
      completedAtMs: createdAtMs,
    }
  }

  return null
}

const upsertActivityPart = (activities: ActivityPart[] | undefined, nextPart: ActivityPart): ActivityPart[] => {
  const current = activities ?? []
  const index = current.findIndex((part) => part.id === nextPart.id)

  if (index < 0) return [...current, nextPart]

  return current.map((part, partIndex) =>
    partIndex === index
      ? {
          ...part,
          ...nextPart,
          startedAtMs: part.startedAtMs ?? nextPart.startedAtMs,
          inputPreview: nextPart.inputPreview ?? part.inputPreview,
          outputPreview: nextPart.outputPreview ?? part.outputPreview,
          detail: nextPart.detail ?? part.detail,
        }
      : part,
  )
}

const mergeActivityPart = (currentPart: ActivityPart, nextPart: ActivityPart): ActivityPart => ({
  ...currentPart,
  ...nextPart,
  startedAtMs: currentPart.startedAtMs ?? nextPart.startedAtMs,
  inputPreview: nextPart.inputPreview ?? currentPart.inputPreview,
  outputPreview: nextPart.outputPreview ?? currentPart.outputPreview,
  detail: nextPart.detail ?? currentPart.detail,
})

const appendAssistantTimelineText = (
  timelineParts: AssistantTimelinePart[] | undefined,
  nextText: string,
): AssistantTimelinePart[] => {
  if (!nextText) return timelineParts ?? []

  const currentParts = timelineParts ?? []
  const lastPart = currentParts[currentParts.length - 1]

  if (lastPart?.type === 'text') {
    return currentParts.map((part, index) =>
      index === currentParts.length - 1 && part.type === 'text' ? { ...part, text: part.text + nextText } : part,
    )
  }

  return [...currentParts, { id: `text:${currentParts.length}`, type: 'text', text: nextText }]
}

const replaceAssistantTimelineText = (
  timelineParts: AssistantTimelinePart[] | undefined,
  text: string,
): AssistantTimelinePart[] => {
  const activityParts = (timelineParts ?? []).filter((part) => part.type === 'activity')

  return text && text !== assistantThinkingText
    ? [...activityParts, { id: 'text:final', type: 'text', text }]
    : activityParts
}

const timelineEndsAtTextBoundary = (timelineParts: AssistantTimelinePart[] | undefined): boolean => {
  const lastPart = timelineParts?.[timelineParts.length - 1]
  if (!lastPart || lastPart.type === 'activity') return true

  const text = lastPart.text
  if (!text.trim()) return false
  if (/\n\s*$/.test(text)) return true

  return /[。！？.!?]\s*$/.test(text)
}

const hasAssistantTimelineActivity = (
  timelineParts: AssistantTimelinePart[] | undefined,
  activityId: string,
): boolean => (timelineParts ?? []).some((part) => part.type === 'activity' && part.activity.id === activityId)

const upsertAssistantTimelineActivity = (
  timelineParts: AssistantTimelinePart[] | undefined,
  nextPart: ActivityPart,
): AssistantTimelinePart[] => {
  const currentParts = timelineParts ?? []
  const index = currentParts.findIndex((part) => part.type === 'activity' && part.activity.id === nextPart.id)

  if (index < 0) {
    return [...currentParts, { id: `activity:${nextPart.id}`, type: 'activity', activity: nextPart }]
  }

  return currentParts.map((part, partIndex) =>
    partIndex === index && part.type === 'activity'
      ? { ...part, activity: mergeActivityPart(part.activity, nextPart) }
      : part,
  )
}

const createHistoricalTimelineParts = (text: string, activities: ActivityPart[]): AssistantTimelinePart[] => {
  const activityParts = activities.map((activity) => ({
    id: `activity:${activity.id}`,
    type: 'activity' as const,
    activity,
  }))

  return text ? [...activityParts, { id: 'text:historical', type: 'text', text }] : activityParts
}

const buildActivityGroupsFromEvents = (events: AgentRunEvent[]): ActivityPart[][] => {
  const groups: ActivityPart[][] = []
  let currentGroup: ActivityPart[] = []
  let sequence = 0

  for (const event of events) {
    const type = getAgentRunEventType(event)
    if (type === 'turn_started' && currentGroup.length > 0) {
      groups.push(currentGroup)
      currentGroup = []
    }

    sequence += 1
    const activityPart = normalizeActivityPart(event, sequence)
    if (activityPart) {
      currentGroup = upsertActivityPart(currentGroup, activityPart)
    }

    if ((type === 'turn_completed' || type === 'turn_failed' || type === 'run_failed') && currentGroup.length > 0) {
      groups.push(currentGroup)
      currentGroup = []
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

const attachActivityGroupsToMessages = (messages: ChatMessage[], events: AgentRunEvent[] | undefined): ChatMessage[] => {
  if (!events?.length) return messages

  const groups = buildActivityGroupsFromEvents(events)
  if (!groups.length) return messages

  const assistantIndexes = messages
    .map((message, index) => (message.role === 'assistant' ? index : -1))
    .filter((index) => index >= 0)
  if (!assistantIndexes.length) return messages

  const startIndex = Math.max(0, assistantIndexes.length - groups.length)
  const groupByMessageIndex = new Map<number, ActivityPart[]>()
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const messageIndex = assistantIndexes[startIndex + groupIndex]
    if (messageIndex === undefined) continue
    groupByMessageIndex.set(messageIndex, groups[groupIndex]!)
  }

  return messages.map((message, index) => {
    const activities = groupByMessageIndex.get(index)
    return activities
      ? { ...message, activities, timelineParts: createHistoricalTimelineParts(message.text, activities) }
      : message
  })
}

const approvalDecisionText = (decision: ApprovalDecision) => {
  if (decision === 'approve_always') return '\u672c\u4f1a\u8bdd\u603b\u662f\u6279\u51c6'
  if (decision === 'reject') return '\u62d2\u7edd'

  return '\u6279\u51c6\u4e00\u6b21'
}

const approvalStatusText = (status: PendingApprovalStatus) => {
  if (status === 'submitting') return '\u63d0\u4ea4\u4e2d'
  if (status === 'approved') return '\u5df2\u6279\u51c6'
  if (status === 'rejected') return '\u5df2\u62d2\u7edd'
  if (status === 'failed') return '\u63d0\u4ea4\u5931\u8d25'

  return '\u7b49\u5f85\u5ba1\u6279'
}

function PendingApprovalCard({
  approval,
  active,
  onDecision,
  stackIndex,
  stackTotal,
}: {
  approval: PendingApprovalItem
  active: boolean
  onDecision: (approvalId: string, decision: ApprovalDecision) => void
  stackIndex: number
  stackTotal: number
}) {
  const locked =
    !active || approval.status === 'submitting' || approval.status === 'approved' || approval.status === 'rejected'
  const statusClass = approval.status === 'failed' ? 'failed' : approval.status === 'pending' ? 'pending' : 'settled'

  return (
    <motion.div
      className={`approval-card approval-card-${approval.status} ${active ? 'active' : 'stacked'}`}
      layout
      style={{ zIndex: 20 - stackIndex }}
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: active ? 1 : 0.72, y: active ? 0 : -12 * stackIndex, scale: active ? 1 : 1 - stackIndex * 0.018 }}
      exit={{ opacity: 0, y: 10, scale: 0.985 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="approval-card-glow" />
      <div className="approval-card-header">
        <div className="approval-card-icon" aria-hidden="true">
          <ShieldCheck size={16} />
        </div>
        <div className="approval-card-title">
          <strong>{'\u9700\u8981\u6279\u51c6'}</strong>
          <span>{approval.toolName}</span>
        </div>
        {stackTotal > 1 ? <span className="approval-stack-count">{`${stackIndex + 1}/${stackTotal}`}</span> : null}
        <span className={`approval-card-status ${statusClass}`}>{approvalStatusText(approval.status)}</span>
      </div>

      <div className="approval-card-body">
        <p className="approval-card-reason">
          {approval.reason ?? '\u5de5\u5177\u8c03\u7528\u6b63\u5728\u7b49\u5f85\u4f60\u7684\u51b3\u5b9a'}
        </p>
        <div className="approval-card-meta">
          {approval.risk ? <span>{approval.risk}</span> : null}
          {approval.safety ? <span>{approval.safety}</span> : null}
          {approval.sandboxMode ? <span>{approval.sandboxMode}</span> : null}
          {approval.approvalPolicy ? <span>{approval.approvalPolicy}</span> : null}
        </div>
        {approval.inputPreview ? (
          <pre className="approval-card-input" aria-label={'\u8f93\u5165'}>
            {approval.inputPreview}
          </pre>
        ) : null}
        {approval.error ? <div className="approval-card-error">{approval.error}</div> : null}
      </div>

      <div className="approval-card-actions">
        <button
          className="approval-action subtle"
          type="button"
          disabled={locked}
          onClick={() => onDecision(approval.id, 'approve_always')}
        >
          <ShieldCheck size={14} />
          <span>{approvalDecisionText('approve_always')}</span>
        </button>
        <button
          className="approval-action primary"
          type="button"
          disabled={locked}
          onClick={() => onDecision(approval.id, 'approve_once')}
        >
          <Check size={14} />
          <span>{approvalDecisionText('approve_once')}</span>
        </button>
        <button
          className="approval-action danger"
          type="button"
          disabled={locked}
          onClick={() => onDecision(approval.id, 'reject')}
        >
          <X size={14} />
          <span>{approvalDecisionText('reject')}</span>
        </button>
      </div>
    </motion.div>
  )
}

function PendingApprovalStack({
  approvals,
  onDecision,
}: {
  approvals: PendingApprovalItem[]
  onDecision: (approvalId: string, decision: ApprovalDecision) => void
}) {
  if (approvals.length === 0) {
    return null
  }

  const orderedApprovals = [...approvals].sort(
    (firstApproval, secondApproval) =>
      (firstApproval.createdAtMs ?? Number.MAX_SAFE_INTEGER) -
      (secondApproval.createdAtMs ?? Number.MAX_SAFE_INTEGER),
  )
  const visibleApprovals = orderedApprovals.slice(0, 4)

  return (
    <div className="approval-stack" aria-live="polite" aria-label={'\u7b49\u5f85\u5ba1\u6279'}>
      <AnimatePresence initial={false}>
        {visibleApprovals.map((approval, index) => (
          <PendingApprovalCard
            approval={approval}
            active={index === 0}
            onDecision={onDecision}
            stackIndex={index}
            stackTotal={orderedApprovals.length}
            key={approval.id}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function MessageAttachmentGrid({
  attachments,
  compact = false,
  onRemove,
}: {
  attachments?: MessageAttachment[]
  compact?: boolean
  onRemove?: (attachmentId: string) => void
}) {
  if (!attachments?.length) {
    return null
  }

  return (
    <div className={`message-attachments ${compact ? 'compact' : ''}`} aria-label="附件">
      {attachments.map((attachment) => {
        const image = isImageAttachment(attachment)
        const title = attachment.path && attachment.path !== attachment.name ? attachment.path : attachment.name

        return (
          <div className={`message-attachment-card ${image ? 'image' : 'file'}`} key={attachment.id} title={title}>
            {image ? (
              <a href={attachment.previewUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${attachment.name}`}>
                <img className="message-attachment-thumb" src={attachment.previewUrl} alt={attachment.name} />
              </a>
            ) : (
              <div className="message-attachment-file-icon" aria-hidden="true">
                <Files size={17} />
              </div>
            )}
            <div className="message-attachment-meta">
              <span className="message-attachment-name">{attachment.name}</span>
              <span className="message-attachment-size">{formatAttachmentSize(attachment.size)}</span>
            </div>
            {onRemove ? (
              <button
                className="message-attachment-remove"
                type="button"
                aria-label={`移除 ${attachment.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const activityStatusLabel = (status: ActivityStatus) => {
  if (status === 'waiting_approval') return 'Waiting'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'running') return 'Running'

  return 'Pending'
}

function ActivityTimeline({ activities }: { activities?: ActivityPart[] }) {
  const [openParts, setOpenParts] = useState<Record<string, boolean>>({})
  const visibleActivities = (activities ?? []).filter(isVisibleActivityPart)

  if (visibleActivities.length === 0) {
    return null
  }

  return (
    <div className="activity-timeline" aria-label="Agent activity timeline">
      {visibleActivities.map((activityPart) => {
        const Icon = compactActivityIcon(activityPart)
        const detailOpen = Boolean(openParts[activityPart.id])
        const hasDetail = Boolean(
          activityPart.detail || activityPart.inputPreview || activityPart.outputPreview || activityPart.toolCallId || activityPart.approvalId,
        )

        return (
          <div className={`activity-step ${activityPart.status}`} key={activityPart.id}>
            <button
              className="activity-step-row"
              type="button"
              disabled={!hasDetail}
              onClick={() => {
                if (!hasDetail) return
                setOpenParts((currentOpenParts) => ({
                  ...currentOpenParts,
                  [activityPart.id]: !currentOpenParts[activityPart.id],
                }))
              }}
            >
              <Icon size={13} />
              <span className="activity-step-text">{activityStepLine(activityPart)}</span>
              {hasDetail ? <ChevronDown size={12} className={detailOpen ? 'open' : ''} /> : null}
            </button>
            {detailOpen ? <ActivityDetailPanel activityPart={activityPart} /> : null}
          </div>
        )
      })}
    </div>
  )
}

const isVisibleActivityPart = (activityPart: ActivityPart) =>
  activityPart.kind !== 'model' && activityPart.kind !== 'context' && activityPart.kind !== 'turn'

const compactActivityIcon = (activityPart: ActivityPart): IconType => {
  if (activityPart.kind === 'approval') return ShieldCheck
  if (activityPart.kind === 'gui') return MousePointer2
  if (activityPart.kind === 'error') return AlertTriangle
  return TerminalSquare
}

const activityStepLine = (activityPart: ActivityPart) => {
  const subject = activitySubject(activityPart)
  const preview = activityPart.kind === 'tool' || activityPart.kind === 'gui'
    ? compactActivityPreview(activityPart.inputPreview ?? activityPart.outputPreview ?? activityPart.summary, 82)
    : compactActivityPreview(activityPart.summary, 82)
  const line = [activityVerb(activityPart), subject].filter(Boolean).join(' ')

  return preview && preview !== subject ? `${line} - ${preview}` : line
}

const activityVerb = (activityPart: ActivityPart) => {
  if (activityPart.kind === 'approval') {
    if (activityPart.status === 'waiting_approval') return '\u7b49\u5f85\u5ba1\u6279'
    if (activityPart.status === 'rejected') return '\u5df2\u62d2\u7edd'
    return '\u5df2\u6279\u51c6'
  }

  if (activityPart.kind === 'error') return '\u8fd0\u884c\u5931\u8d25'
  if (activityPart.status === 'running' || activityPart.status === 'pending') return '\u6b63\u5728\u8fd0\u884c'
  if (activityPart.status === 'failed' || activityPart.status === 'rejected') return '\u8fd0\u884c\u5931\u8d25'

  return '\u5df2\u8fd0\u884c'
}

const activitySubject = (activityPart: ActivityPart) => {
  if (activityPart.kind === 'approval') {
    return cleanActivityTitle(activityPart.title).replace(/^Waiting for approval:?\s*/i, '') || '\u5de5\u5177\u8bf7\u6c42'
  }

  if (activityPart.kind === 'error') {
    return compactActivityPreview(activityPart.summary || activityPart.title, 80) ?? '\u4efb\u52a1'
  }

  const cleanTitle = cleanActivityTitle(activityPart.title)
  const toolName = cleanTitle
    .replace(/^Running\s+/i, '')
    .replace(/\s+(result|completed|failed)$/i, '')
    .trim()

  return toolName || '\u5de5\u5177'
}

const cleanActivityTitle = (title: string) => title.replace(/[_-]+/g, ' ').trim()

function ActivityDetailPanel({ activityPart }: { activityPart: ActivityPart }) {
  return (
    <div className="activity-detail-panel">
      <div className="activity-detail-title">{activityPart.title}</div>
      {activityPart.inputPreview ? (
        <pre>
          <code>{activityPart.inputPreview}</code>
        </pre>
      ) : null}
      {activityPart.outputPreview ? (
        <pre>
          <code>{activityPart.outputPreview}</code>
        </pre>
      ) : null}
      {activityPart.detail ? (
        <pre>
          <code>{activityPart.detail}</code>
        </pre>
      ) : null}
      <div className={`activity-detail-result ${activityPart.status}`}>{activityStatusLabel(activityPart.status)}</div>
    </div>
  )
}

function AssistantTimelineContent({ message }: { message: ChatMessage }) {
  const timelineParts = message.timelineParts ?? []
  const hasTimelineParts = timelineParts.some((part) =>
    part.type === 'text' ? part.text.length > 0 : isVisibleActivityPart(part.activity),
  )

  if (!hasTimelineParts) {
    const visibleActivities = (message.activities ?? []).filter(isVisibleActivityPart)

    return (
      <>
        {visibleActivities.length > 0 ? <ActivityTimeline activities={visibleActivities} /> : null}
        <AssistantMarkdown text={message.text} />
      </>
    )
  }

  return (
    <>
      {timelineParts.map((part) =>
        part.type === 'text' ? (
          part.text ? <AssistantMarkdown key={part.id} text={part.text} /> : null
        ) : (
          <ActivityTimeline key={part.id} activities={[part.activity]} />
        ),
      )}
    </>
  )
}

function ChatTranscript({ messages }: { messages: ChatMessage[] }) {
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return

    const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
    if (distanceFromBottom > 260) return

    window.requestAnimationFrame(() => {
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' })
    })
  }, [messages])

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text)
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = message.text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        // Some embedded browser contexts block clipboard access; keep the UI responsive.
      }
    }

    setCopiedMessageId(message.id)
    window.setTimeout(() => {
      setCopiedMessageId((currentMessageId) => (currentMessageId === message.id ? null : currentMessageId))
    }, 1200)
  }

  const lastAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant')?.id

  return (
    <div className="message-stack chat-transcript" aria-label="chat content" ref={transcriptRef}>
      <div className="chat-stream">
        {messages.map((message) => {
          if (message.role === 'user') {
            return (
              <motion.div
                className="chat-row user-row"
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
              >
                <div className="user-bubble">
                  {message.text ? <div>{message.text}</div> : null}
                  <MessageAttachmentGrid attachments={message.attachments} />
                </div>
              </motion.div>
            )
          }

          const complete = message.text !== assistantThinkingText && !message.streaming
          const latest = complete && message.id === lastAssistantMessageId
          const actionClass = complete ? (latest ? 'assistant-latest' : 'assistant-history') : 'assistant-generating'

          return (
            <motion.div
              className={`chat-row assistant-row ${actionClass}`}
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24 }}
            >
              <div className="assistant-reply">
                <AssistantTimelineContent message={message} />
                {complete ? (
                  <div className="message-actions" aria-label="message actions">
                    <button
                      className="message-action-button"
                      type="button"
                      aria-label={copiedMessageId === message.id ? "\u5df2\u590d\u5236\u56de\u590d" : "\u590d\u5236\u56de\u590d"}
                      title={copiedMessageId === message.id ? "\u5df2\u590d\u5236" : "\u590d\u5236"}
                      onClick={() => void copyMessage(message)}
                    >
                      {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button className="message-action-button" type="button" aria-label="expand reply">
                      <Maximize2 size={13} />
                    </button>
                    <span className="message-time">{message.time}</span>
                  </div>
                ) : null}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function GoalAttachmentCard({
  goal,
  draftText,
  drafting,
  onEdit,
  onDelete,
  onPauseToggle,
  onContinueGoal,
  busy,
  error,
}: {
  goal: AttachedGoal | null
  draftText: string
  drafting: boolean
  onEdit: () => void
  onDelete: () => void
  onPauseToggle: () => void
  onContinueGoal: () => void
  busy?: boolean
  error?: string
}) {
  const summary = drafting ? draftText.trim() || '\u8f93\u5165\u76ee\u6807\u540e\u70b9\u51fb\u53d1\u9001' : goal?.text ?? ''
  const paused = Boolean(goal?.paused)
  const statusLabel = error
    ? '\u76ee\u6807\u672a\u4fdd\u5b58'
    : drafting
      ? '\u65b0\u76ee\u6807'
      : paused
        ? '\u5df2\u6682\u505c\u76ee\u6807'
        : '\u8fdb\u884c\u4e2d\u7684\u76ee\u6807'
  const stateLabel = busy ? '\u6b63\u5728\u4fdd\u5b58' : error ? '\u4fdd\u5b58\u5931\u8d25' : drafting ? '\u6b63\u5728\u586b\u5199' : undefined

  return (
    <motion.div
      className={'goal-attachment-card ' + (drafting ? 'drafting' : '') + ' ' + (paused ? 'paused' : '')}
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.985 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      <div className="goal-attachment-icon" aria-hidden="true">
        <Target size={15} />
      </div>
      <div className="goal-attachment-copy">
        <div className="goal-attachment-kicker">
          <span className="goal-attachment-status">{statusLabel}</span>
          <strong className="goal-attachment-text">{summary}</strong>
          {stateLabel ? <span className="goal-attachment-state">{stateLabel}</span> : null}
        </div>
      </div>
      <div className="goal-attachment-actions" aria-label="Goal actions">
        {!drafting && goal ? (
          <>
            <button className="goal-icon-button" type="button" aria-label={'\u7f16\u8f91\u76ee\u6807'} title={'\u7f16\u8f91\u76ee\u6807'} onClick={onEdit}>
              <Edit3 size={14} />
            </button>
            {!paused ? (
              <button className="goal-icon-button primary" type="button" aria-label={'\u8fd0\u884c\u76ee\u6807'} title={'\u8fd0\u884c\u76ee\u6807'} onClick={onContinueGoal} disabled={busy}>
                <RefreshCw size={14} />
              </button>
            ) : null}
            <button
              className={'goal-icon-button ' + (paused ? 'active' : '')}
              type="button"
              aria-label={paused ? '\u7ee7\u7eed\u76ee\u6807' : '\u6682\u505c\u76ee\u6807'}
              title={paused ? '\u7ee7\u7eed\u76ee\u6807' : '\u6682\u505c\u76ee\u6807'}
              onClick={onPauseToggle}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </>
        ) : null}
        <button className="goal-icon-button danger" type="button" aria-label={'\u5220\u9664\u76ee\u6807'} title={'\u5220\u9664\u76ee\u6807'} onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  )
}

function Composer({
  onSend,
  goal,
  onCreateGoal,
  onToggleGoalPaused,
  onContinueGoal,
  onClearGoal,
  contextUsage,
}: {
  onSend: (payload: ComposerSendPayload) => void
  goal: AttachedGoal | null
  onCreateGoal: (objective: string) => Promise<boolean>
  onToggleGoalPaused: () => Promise<void>
  onContinueGoal: () => Promise<void>
  onClearGoal: () => Promise<void>
  contextUsage?: ContextUsage
}) {
  const [attachOpen, setAttachOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalMode, setApprovalMode] = useState<string>(defaultApprovalMode)
  const [modelOpen, setModelOpen] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [modelManagerOpen, setModelManagerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [selectedModel, setSelectedModel] = useState(() => readStoredSelectedModel() ?? defaultModelLabel)
  const [availableModelGroups, setAvailableModelGroups] = useState<ModelGroup[]>(modelGroups)
  const [visibleModelKeys, setVisibleModelKeys] = useState<Set<string> | null>(null)
  const [message, setMessage] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<MessageAttachment[]>([])
  const [goalCaptureActive, setGoalCaptureActive] = useState(false)
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalError, setGoalError] = useState<string | undefined>()
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const slashMenuState = goalCaptureActive ? null : getSlashMenuState(message)
  const goalVisible = goalCaptureActive || Boolean(goal)
  const canSend = goalCaptureActive ? message.trim().length > 0 : message.trim().length > 0 || selectedAttachments.length > 0
  const contextUsedPercent = contextUsage?.percentUsed ?? 0
  const contextMeterTone = contextUsedPercent >= 90 ? 'full' : contextUsedPercent >= 70 ? 'warning' : 'normal'
  const contextMeterStyle = { '--context-progress': `${contextUsedPercent}%` } as CSSProperties
  const contextMeterText = describeContextUsage(contextUsage)
  const visibleModelGroups = availableModelGroups
    .map((group) => ({
      ...group,
      models: group.models.filter((model) => {
        if (!visibleModelKeys) {
          return true
        }

        return visibleModelKeys.has(modelVisibilityKey(group.provider, model))
      }),
    }))
    .filter((group) => group.models.length > 0)

  const applyAvailableModelGroups = (groups: ModelGroup[] | undefined) => {
    const nextGroups = groups ?? []

    setAvailableModelGroups(nextGroups)
    setSelectedModel((currentModel) => {
      const storedModel = readStoredSelectedModel()
      const nextModel = storedModel && modelExistsInGroups(nextGroups, storedModel)
        ? storedModel
        : modelExistsInGroups(nextGroups, currentModel)
          ? currentModel
          : firstModelFromGroups(nextGroups) ?? defaultModelLabel

      writeStoredSelectedModel(nextModel === defaultModelLabel ? undefined : nextModel)
      return nextModel
    })
  }

  const refreshAvailableModelGroups = () => {
    void loadModelGroups().then(applyAvailableModelGroups)
  }

  useEffect(() => {
    let active = true

    void loadModelGroups().then((groups) => {
      if (active) {
        applyAvailableModelGroups(groups)
      }
    })

    return () => {
      active = false
    }
  }, [])

  const focusComposerInput = () => {
    window.requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  const startGoalCapture = (seedText = '') => {
    setMessage(seedText)
    setGoalCaptureActive(true)
    setGoalError(undefined)
    setAttachOpen(false)
    setModelOpen(false)
    setApprovalOpen(false)
    setProviderDialogOpen(false)
    setModelManagerOpen(false)
    focusComposerInput()
  }

  const deleteGoal = () => {
    setGoalCaptureActive(false)
    setGoalError(undefined)
    setMessage('')
    void onClearGoal().finally(focusComposerInput)
  }

  const toggleGoalPaused = () => {
    void onToggleGoalPaused().finally(focusComposerInput)
  }

  const runGoal = () => {
    void onContinueGoal().finally(focusComposerInput)
  }

  const isGoalSlashCommand = (value: string) => {
    const command = value.trim().replace(/^\/+/, '').toLocaleLowerCase()
    return command === 'goal' || command === '\u76ee\u6807'
  }

  const updateMessage = (nextMessage: string) => {
    setMessage(nextMessage)

    if (!goalCaptureActive && nextMessage.trimStart().startsWith("/")) {
      setAttachOpen(false)
      setModelOpen(false)
      setApprovalOpen(false)
      setProviderDialogOpen(false)
      setModelManagerOpen(false)
    }
  }

  const selectSlashCommand = (item: SlashCommandItem) => {
    if (item.id === 'goal') {
      startGoalCapture('')
    }
  }

  const openFilePicker = () => {
    setAttachOpen(false)
    setProviderDialogOpen(false)
    setModelManagerOpen(false)
    fileInputRef.current?.click()
  }

  const openFolderPicker = () => {
    setAttachOpen(false)
    setProviderDialogOpen(false)
    setModelManagerOpen(false)
    folderInputRef.current?.click()
  }

  const addPickedFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])

    if (files.length > 0) {
      setSelectedAttachments((currentAttachments) => [...currentAttachments, ...files.map(fileToMessageAttachment)])
    }

    event.currentTarget.value = ''
    focusComposerInput()
  }

  const removeSelectedAttachment = (attachmentId: string) => {
    setSelectedAttachments((currentAttachments) => {
      const target = currentAttachments.find((attachment) => attachment.id === attachmentId)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
      }

      return currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    })
  }

  const toggleVisibleModel = (provider: string, model: string) => {
    const key = modelVisibilityKey(provider, model)

    setVisibleModelKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys ?? modelVisibilityKeys(availableModelGroups))

      if (nextKeys.has(key)) {
        nextKeys.delete(key)
        if (selectedModel === model) {
          setSelectedModel(defaultModelLabel)
          writeStoredSelectedModel(undefined)
        }
      } else {
        nextKeys.add(key)
      }

      return nextKeys
    })
  }

  const submitMessage = async () => {
    const trimmedMessage = message.trim()

    if (goalBusy) {
      return
    }

    if (goalCaptureActive) {
      if (!trimmedMessage) {
        return
      }
      setGoalBusy(true)
      setGoalError(undefined)
      const created = await onCreateGoal(trimmedMessage)
      setGoalBusy(false)
      if (!created) {
        setGoalError('goal_save_failed')
        focusComposerInput()
        return
      }
      setGoalCaptureActive(false)
      setMessage('')
      focusComposerInput()
      return
    }

    if (!trimmedMessage && selectedAttachments.length === 0) {
      return
    }

    if (isGoalSlashCommand(trimmedMessage)) {
      startGoalCapture('')
      return
    }

    const outboundAttachments = selectedAttachments

    onSend({
      message: trimmedMessage || '已添加附件',
      approvalMode,
      modelId: selectedModel === defaultModelLabel ? undefined : selectedModel,
      goalId: goal && !goal.paused ? goal.goalId : undefined,
      attachments: outboundAttachments,
    })
    setMessage('')
    setSelectedAttachments([])
  }

  return (
    <div className={'composer-zone ' + (goalVisible ? 'has-goal' : '')}>
      <ProviderConnectDialog
        open={providerDialogOpen}
        onClose={() => setProviderDialogOpen(false)}
        onProvidersChanged={refreshAvailableModelGroups}
      />
      <ModelManageDialog
        open={modelManagerOpen}
        modelGroups={availableModelGroups}
        visibleModelKeys={visibleModelKeys}
        onClose={() => setModelManagerOpen(false)}
        onToggleModel={toggleVisibleModel}
        onConnectProvider={() => {
          setModelManagerOpen(false)
          setProviderDialogOpen(true)
        }}
      />

      <AnimatePresence>
        {slashMenuState ? (
          <SlashCommandMenu state={slashMenuState} onSelectCommand={selectSlashCommand} />
        ) : attachOpen ? (
          <AttachMenu
            onSelectGoal={() => startGoalCapture('')}
            onSelectFile={openFilePicker}
            onSelectFolder={openFolderPicker}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {goalVisible ? (
          <GoalAttachmentCard
            goal={goal}
            draftText={message}
            drafting={goalCaptureActive}
            onEdit={() => startGoalCapture(goal?.text ?? '')}
            onDelete={deleteGoal}
            onPauseToggle={toggleGoalPaused}
            onContinueGoal={runGoal}
            busy={goalBusy}
            error={goalError}
          />
        ) : null}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={addPickedFiles}
      />
      <input
        ref={(element) => {
          folderInputRef.current = element
          if (element) {
            element.setAttribute('webkitdirectory', '')
            element.setAttribute('directory', '')
          }
        }}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={addPickedFiles}
      />

      <div className={`composer ${selectedAttachments.length > 0 ? 'has-attachments' : ''}`}>
        <MessageAttachmentGrid attachments={selectedAttachments} compact onRemove={removeSelectedAttachment} />
        <textarea
          ref={composerInputRef}
          className="composer-input"
          aria-label={goalCaptureActive ? '\u76ee\u6807\u8f93\u5165' : '\u6d88\u606f\u8f93\u5165'}
          placeholder={goalCaptureActive ? '\u8f93\u5165\u76ee\u6807\uff0c\u7136\u540e\u53d1\u9001' : '\u8981\u6c42\u540e\u7eed\u53d8\u66f4'}
          value={message}
          onInput={(event) => updateMessage(event.currentTarget.value)}
          onChange={(event) => updateMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              const firstCommand = slashMenuState?.commands[0]

              if (firstCommand?.id === 'goal') {
                selectSlashCommand(firstCommand)
                return
              }

              void submitMessage()
            }
          }}
        />

        <div className="composer-controls">
          <button
            className={`round-tool ${attachOpen ? 'active' : ''}`}
            type="button"
            aria-label="添加"
            onClick={() => {
              setAttachOpen((value) => {
                const nextOpen = !value

                if (nextOpen) {
                  setApprovalOpen(false)
                  setModelOpen(false)
                  setProviderDialogOpen(false)
                  setModelManagerOpen(false)
                }

                return nextOpen
              })
            }}
          >
            <Plus size={18} />
          </button>

          <div className="approval-wrap">
            <button
              className={`approval-trigger ${approvalOpen ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setApprovalOpen((value) => {
                  const nextOpen = !value

                  if (nextOpen) {
                    setAttachOpen(false)
                    setModelOpen(false)
                    setProviderDialogOpen(false)
                    setModelManagerOpen(false)
                  }

                  return nextOpen
                })
              }}
            >
              <Gauge size={14} />
              <span>{approvalModeLabel(approvalMode)}</span>
              <ChevronDown size={13} />
            </button>
            <ApprovalMenu
              open={approvalOpen}
              onModeChange={(mode) => {
                setApprovalMode(mode)
                setApprovalOpen(false)
              }}
            />
          </div>

          <div className="model-wrap">
            <button
              className={`model-button ${modelOpen ? 'active' : ''}`}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={modelOpen}
              onClick={() => {
                setModelOpen((value) => {
                  const nextOpen = !value

                  if (nextOpen) {
                    setAttachOpen(false)
                    setApprovalOpen(false)
                    setProviderDialogOpen(false)
                    setModelManagerOpen(false)
                  }

                  return nextOpen
                })
              }}
            >
              <Cpu size={14} />
              <span>{selectedModel}</span>
              <ChevronDown size={13} />
            </button>
            <AnimatePresence>
              {modelOpen ? (
                <ModelMenu
                  query={modelQuery}
                  selectedModel={selectedModel}
                  modelGroups={visibleModelGroups}
                  onQueryChange={setModelQuery}
                  onSelectModel={(model) => {
                    setSelectedModel(model)
                    writeStoredSelectedModel(model)
                    setModelQuery('')
                    setModelOpen(false)
                  }}
                  onAddModel={() => {
                    setModelOpen(false)
                    setModelQuery('')
                    setProviderDialogOpen(true)
                  }}
                  onManageModels={() => {
                    setModelOpen(false)
                    setModelQuery('')
                    setProviderDialogOpen(false)
                    setModelManagerOpen(true)
                  }}
                />
              ) : null}
            </AnimatePresence>
          </div>

          <div
            className={`context-meter ${contextMeterTone}`}
            style={contextMeterStyle}
            tabIndex={0}
            aria-label={contextUsage?.percentUsed !== undefined ? `上下文状态，已用${contextUsedPercent}%` : '上下文状态，等待后端事件'}
          >
            <span className="context-meter-ring" aria-hidden="true">
              <span className="context-meter-core" />
            </span>
            <span className="context-tooltip">{contextMeterText}</span>
          </div>

          <button className="mic-button" type="button" aria-label="语音输入">
            <Mic size={16} />
          </button>

          <button className="send-button" type="button" aria-label="发送" disabled={!canSend} onClick={submitMessage}>
            <SendHorizontal size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}

function MainChat({ activeChat, onChatTitleUpdate }: { activeChat: ActiveChat; onChatTitleUpdate?: (chatId: string, threadId: string, title: string) => void }) {
  const [messagesByChat, setMessagesByChat] = useState<Record<string, ChatMessage[]>>({})
  const [conversationIdsByChat, setConversationIdsByChat] = useState<Record<string, string>>({})
  const [attachedGoal, setAttachedGoal] = useState<AttachedGoal | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, PendingApprovalItem>>({})
  const [contextUsageByChat, setContextUsageByChat] = useState<Record<string, ContextUsage>>({})
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const smoothWritersRef = useRef<Map<number, SmoothWriterState>>(new Map())
  const activitySequenceRef = useRef(0)
  const activeConversationId = conversationIdsByChat[activeChat.id] ?? activeChat.conversationId
  const messages = messagesByChat[activeChat.id] ?? initialMessages
  const contextUsage = contextUsageByChat[activeChat.id]
  const visiblePendingApprovals = Object.values(pendingApprovals).filter(
    (approval) => !approval.threadId || !activeConversationId || approval.threadId === activeConversationId,
  )

  useEffect(() => {
    let active = true

    if (!activeConversationId) {
      setAttachedGoal(null)
      return () => {
        active = false
      }
    }

    void loadThreadGoal(activeConversationId).then((goalSummary) => {
      if (active) {
        setAttachedGoal(goalSummary ? goalSummaryToAttachedGoal(goalSummary) : null)
      }
    })

    return () => {
      active = false
    }
  }, [activeConversationId])

  useEffect(() => {
    let active = true

    if (activeConversationId) {
      void Promise.all([
        loadConversationMessages(activeConversationId),
        loadConversationEvents(activeConversationId),
      ]).then(([loadedMessages, loadedEvents]) => {
        if (active && loadedMessages && loadedMessages.length > 0) {
          setMessagesByChat((currentMessagesByChat) => ({
            ...currentMessagesByChat,
            [activeChat.id]: attachActivityGroupsToMessages(loadedMessages, loadedEvents),
          }))
        }

        const loadedContextUsage = deriveContextUsageFromEvents(loadedEvents)
        if (active && loadedContextUsage) {
          setContextUsageByChat((currentUsageByChat) => ({
            ...currentUsageByChat,
            [activeChat.id]: loadedContextUsage,
          }))
        }
      })
    }

    return () => {
      active = false
    }
  }, [activeChat.id, activeConversationId])
  useEffect(() => {
    return () => {
      for (const writer of smoothWritersRef.current.values()) {
        if (writer.timer !== null) {
          window.clearTimeout(writer.timer)
        }
      }
      smoothWritersRef.current.clear()
    }
  }, [])

  const flushPendingActivitiesIntoTimeline = (
    assistantId: number,
    timelineParts: AssistantTimelinePart[] | undefined,
  ): AssistantTimelinePart[] => {
    const writer = smoothWritersRef.current.get(assistantId)
    if (!writer?.pendingActivities.length) return timelineParts ?? []

    let nextTimelineParts = timelineParts ?? []
    for (const activityPart of writer.pendingActivities) {
      nextTimelineParts = upsertAssistantTimelineActivity(nextTimelineParts, activityPart)
    }
    writer.pendingActivities = []
    return nextTimelineParts
  }

  const flushPendingAssistantActivities = (assistantId: number) => {
    const writer = smoothWritersRef.current.get(assistantId)
    if (!writer?.pendingActivities.length) return

    setMessagesByChat((currentMessagesByChat) => ({
      ...currentMessagesByChat,
      [activeChat.id]: (currentMessagesByChat[activeChat.id] ?? initialMessages).map((message) =>
        message.id === assistantId
          ? {
              ...message,
              timelineParts: flushPendingActivitiesIntoTimeline(assistantId, message.timelineParts),
            }
          : message,
      ),
    }))
  }

  const updateAssistantMessage = (assistantId: number, nextText: string, append = false) => {
    setMessagesByChat((currentMessagesByChat) => ({
      ...currentMessagesByChat,
      [activeChat.id]: (currentMessagesByChat[activeChat.id] ?? initialMessages).map((message) => {
        if (message.id !== assistantId) return message

        const nextTimelineParts = append
          ? appendAssistantTimelineText(message.timelineParts, nextText)
          : replaceAssistantTimelineText(message.timelineParts, nextText)
        const timelineParts =
          !append || timelineEndsAtTextBoundary(nextTimelineParts)
            ? flushPendingActivitiesIntoTimeline(assistantId, nextTimelineParts)
            : nextTimelineParts

        return {
          ...message,
          text: append ? (message.text === assistantThinkingText ? '' : message.text) + nextText : nextText,
          timelineParts,
          streaming: append ? message.streaming : false,
        }
      }),
    }))
  }

  const updateAssistantActivity = (assistantId: number, event: AgentRunEvent) => {
    activitySequenceRef.current += 1
    const activityPart = normalizeActivityPart(event, activitySequenceRef.current)
    if (!activityPart) return

    setMessagesByChat((currentMessagesByChat) => ({
      ...currentMessagesByChat,
      [activeChat.id]: (currentMessagesByChat[activeChat.id] ?? initialMessages).map((message) => {
        if (message.id !== assistantId) return message

        const writer = smoothWritersRef.current.get(assistantId)
        const shouldDeferActivity =
          Boolean(writer) &&
          !writer?.completed &&
          !hasAssistantTimelineActivity(message.timelineParts, activityPart.id) &&
          !timelineEndsAtTextBoundary(message.timelineParts)

        if (shouldDeferActivity && writer) {
          writer.pendingActivities = upsertActivityPart(writer.pendingActivities, activityPart)
          return {
            ...message,
            activities: upsertActivityPart(message.activities, activityPart),
          }
        }

        return {
          ...message,
          activities: upsertActivityPart(message.activities, activityPart),
          timelineParts: upsertAssistantTimelineActivity(message.timelineParts, activityPart),
        }
      }),
    }))
  }

  function scheduleSmoothWriter(assistantId: number, delayMs = 0) {
    const writer = smoothWritersRef.current.get(assistantId)
    if (!writer || writer.timer !== null) return

    writer.timer = window.setTimeout(() => drainSmoothWriter(assistantId), delayMs)
  }

  const setAssistantStreaming = (assistantId: number, streaming: boolean) => {
    setMessagesByChat((currentMessagesByChat) => ({
      ...currentMessagesByChat,
      [activeChat.id]: (currentMessagesByChat[activeChat.id] ?? initialMessages).map((message) =>
        message.id === assistantId ? { ...message, streaming } : message,
      ),
    }))
  }

  function drainSmoothWriter(assistantId: number) {
    const writer = smoothWritersRef.current.get(assistantId)
    if (!writer) return

    writer.timer = null
    if (!writer.queue) {
      if (writer.completed) {
        flushPendingAssistantActivities(assistantId)
        setAssistantStreaming(assistantId, false)
        smoothWritersRef.current.delete(assistantId)
      }
      return
    }

    const nextChunk = takeSmoothStreamChunk(writer.queue, writer.completed)
    writer.queue = nextChunk.rest
    updateAssistantMessage(assistantId, nextChunk.chunk, true)

    if (writer.queue) {
      scheduleSmoothWriter(assistantId, nextChunk.delayMs)
      return
    }

    if (writer.completed) {
      flushPendingAssistantActivities(assistantId)
      setAssistantStreaming(assistantId, false)
      smoothWritersRef.current.delete(assistantId)
    }
  }

  const enqueueSmoothAssistantText = (assistantId: number, delta: string) => {
    const writer =
      smoothWritersRef.current.get(assistantId) ?? { queue: '', timer: null, completed: false, pendingActivities: [] }
    writer.queue += delta
    smoothWritersRef.current.set(assistantId, writer)
    scheduleSmoothWriter(assistantId)
  }

  const completeSmoothAssistantText = (assistantId: number) => {
    const writer = smoothWritersRef.current.get(assistantId)
    if (!writer) {
      setAssistantStreaming(assistantId, false)
      return
    }

    writer.completed = true
    if (writer.timer !== null) {
      window.clearTimeout(writer.timer)
      writer.timer = null
    }
    scheduleSmoothWriter(assistantId)
  }

  const removeApprovalAfterDelay = (approvalId: string) => {
    window.setTimeout(() => {
      setPendingApprovals((currentApprovals) => {
        const currentApproval = currentApprovals[approvalId]
        if (!currentApproval || currentApproval.status === 'pending' || currentApproval.status === 'submitting') {
          return currentApprovals
        }

        const nextApprovals = { ...currentApprovals }
        delete nextApprovals[approvalId]
        return nextApprovals
      })
    }, 1800)
  }

  const reconcilePendingApprovals = async (options: { clearSubmitting?: boolean; targetApprovalId?: string } = {}) => {
    const pending = await loadPendingApprovals()
    if (!pending) {
      return false
    }

    const pendingIds = new Set(pending.map((approval) => approval.approvalId))
    const targetCleared = Boolean(options.targetApprovalId && !pendingIds.has(options.targetApprovalId))

    setPendingApprovals((currentApprovals) => {
      let changed = false
      const nextApprovals = { ...currentApprovals }

      for (const [approvalId, approval] of Object.entries(currentApprovals)) {
        if (pendingIds.has(approvalId)) {
          continue
        }

        if (approval.status === 'failed' || (options.clearSubmitting && approval.status === 'submitting')) {
          delete nextApprovals[approvalId]
          changed = true
        }
      }

      return changed ? nextApprovals : currentApprovals
    })

    return targetCleared
  }

  useEffect(() => {
    let active = true

    const syncApprovals = () => {
      if (active) {
        void reconcilePendingApprovals()
      }
    }

    syncApprovals()
    const intervalId = window.setInterval(syncApprovals, 3000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [activeConversationId])

  const handleRunEvent = (event: AgentRunEvent, assistantId?: number) => {
    if (assistantId !== undefined) {
      updateAssistantActivity(assistantId, event)
    }

    setContextUsageByChat((currentUsageByChat) => {
      const nextUsage = extractContextUsageFromEvent(event, currentUsageByChat[activeChat.id])

      return nextUsage ? { ...currentUsageByChat, [activeChat.id]: nextUsage } : currentUsageByChat
    })

    const type = getAgentRunEventType(event)

    if (type === 'goal_updated') {
      const goalSummary = normalizeGoalEventSummary(event)
      if (goalSummary && (!activeConversationId || goalSummary.threadId === activeConversationId)) {
        setAttachedGoal(goalSummaryToAttachedGoal(goalSummary))
      }
      return
    }

    if (type === 'goal_cleared') {
      const goalSummary = normalizeGoalEventSummary(event)
      if (!goalSummary?.threadId || !activeConversationId || goalSummary.threadId === activeConversationId) {
        setAttachedGoal(null)
      }
      return
    }

    if (type === 'thread_title_updated') {
      const threadId = agentEventString(event, 'threadId')
      const title = agentEventString(event, 'title')

      if (threadId && title) {
        onChatTitleUpdate?.(activeChat.id, threadId, title)
        window.dispatchEvent(new CustomEvent('pando:workspace-updated'))
      }

      return
    }

    if (type === 'approval_pending' || type === 'approval_requested') {
      const approval = normalizePendingApproval(event)
      if (!approval) {
        return
      }

      setPendingApprovals((currentApprovals) => ({
        ...currentApprovals,
        [approval.id]: { ...currentApprovals[approval.id], ...approval, status: currentApprovals[approval.id]?.status ?? 'pending' },
      }))
      return
    }

    if (type === 'approval_answered' || type === 'approval_completed') {
      const approvalId = getApprovalEventId(event)
      if (!approvalId) {
        return
      }

      const decision = agentEventString(event, 'decision')
      const status: PendingApprovalStatus = decision === 'reject' ? 'rejected' : 'approved'

      setPendingApprovals((currentApprovals) => {
        const currentApproval = currentApprovals[approvalId]
        if (!currentApproval) {
          return currentApprovals
        }

        return {
          ...currentApprovals,
          [approvalId]: { ...currentApproval, status, error: undefined },
        }
      })
      removeApprovalAfterDelay(approvalId)
    }
  }

  const handleApprovalDecision = (approvalId: string, decision: ApprovalDecision) => {
    setPendingApprovals((currentApprovals) => {
      const currentApproval = currentApprovals[approvalId]
      if (!currentApproval || currentApproval.status === 'submitting') {
        return currentApprovals
      }

      return {
        ...currentApprovals,
        [approvalId]: { ...currentApproval, status: 'submitting', error: undefined },
      }
    })

    void (async () => {
      const result = await resolveApproval(approvalId, decision)
      if (!result) {
        const clearedByBackendState = await reconcilePendingApprovals({
          clearSubmitting: true,
          targetApprovalId: approvalId,
        })
        if (clearedByBackendState) {
          return
        }

        setPendingApprovals((currentApprovals) => {
          const currentApproval = currentApprovals[approvalId]
          if (!currentApproval) {
            return currentApprovals
          }

          return {
            ...currentApprovals,
            [approvalId]: { ...currentApproval, status: 'failed', error: '\u63d0\u4ea4\u5931\u8d25\uff0c\u53ef\u4ee5\u91cd\u8bd5' },
          }
        })
        return
      }

      const status: PendingApprovalStatus = decision === 'reject' ? 'rejected' : 'approved'
      setPendingApprovals((currentApprovals) => {
        const currentApproval = currentApprovals[approvalId]
        if (!currentApproval) {
          return currentApprovals
        }

        return {
          ...currentApprovals,
          [approvalId]: { ...currentApproval, status, error: undefined },
        }
      })
      removeApprovalAfterDelay(approvalId)
    })()
  }

  const handleCreateGoal = async (objective: string) => {
    const conversationId = await ensureConversationId()
    if (!conversationId) {
      return false
    }

    const summary = await setThreadGoal(conversationId, { objective, status: 'active' })
    if (!summary) {
      return false
    }

    setAttachedGoal(goalSummaryToAttachedGoal(summary))
    return true
  }

  const handleToggleGoalPaused = async () => {
    const currentGoal = attachedGoal
    const threadId = currentGoal?.threadId ?? activeConversationId
    if (!currentGoal || !threadId) {
      return
    }

    const summary = await setThreadGoal(threadId, { status: currentGoal.paused ? 'active' : 'paused' })
    if (summary) {
      setAttachedGoal(goalSummaryToAttachedGoal(summary))
    }
  }

  const handleContinueGoal = async () => {
    const currentGoal = attachedGoal
    if (!currentGoal || currentGoal.paused) {
      return
    }

    const conversationId = currentGoal.threadId ?? (await ensureConversationId())
    if (!conversationId) {
      return
    }

    const assistantId = Date.now() + 1
    setMessagesByChat((currentMessagesByChat) => {
      const currentMessages = currentMessagesByChat[activeChat.id] ?? initialMessages
      return {
        ...currentMessagesByChat,
        [activeChat.id]: [
          ...currentMessages,
          { id: assistantId, role: 'assistant', text: assistantThinkingText, time: formatMessageTime(), activities: [], timelineParts: [], streaming: true },
        ],
      }
    })

    try {
      const result = await continueThreadGoal(conversationId)
      if (!result?.runId) {
        updateAssistantMessage(assistantId, backendUnavailableReply)
        return
      }
      if (result.summary) {
        setAttachedGoal(goalSummaryToAttachedGoal(result.summary))
      }

      let sawDelta = false
      streamRun(result.threadId ?? conversationId, result.runId, {
        onDelta: (delta) => {
          sawDelta = true
          enqueueSmoothAssistantText(assistantId, delta)
        },
        onEvent: (event) => handleRunEvent(event, assistantId),
        onDone: () => {
          completeSmoothAssistantText(assistantId)
          void loadThreadGoal(conversationId).then((goalSummary) => {
            setAttachedGoal(goalSummary ? goalSummaryToAttachedGoal(goalSummary) : null)
          })
        },
        onError: () => {
          completeSmoothAssistantText(assistantId)
          if (!sawDelta) {
            updateAssistantMessage(assistantId, backendUnavailableReply)
          }
        },
      })
    } catch {
      updateAssistantMessage(assistantId, backendUnavailableReply)
    }
  }

  const handleClearGoal = async () => {
    const threadId = attachedGoal?.threadId ?? activeConversationId
    if (threadId) {
      await clearThreadGoal(threadId)
    }
    setAttachedGoal(null)
  }

  const refreshActiveChatTitle = (threadId?: string) => {
    if (!threadId) {
      return
    }

    void loadWorkspaceSnapshot()
      .then((snapshot) => {
        const chat = snapshot?.chats?.find((item) => item.id === threadId)
        if (!chat?.name) {
          return
        }

        onChatTitleUpdate?.(activeChat.id, threadId, chat.name)
        window.dispatchEvent(new CustomEvent('pando:workspace-updated'))
      })
      .catch(() => undefined)
  }

  const ensureConversationId = async () => {
    if (activeConversationId) {
      return activeConversationId
    }

    const createdConversation = await createConversation({ title: activeChat.title, scope: { type: 'global' } })

    if (!createdConversation?.id) {
      return undefined
    }

    setConversationIdsByChat((currentIds) => ({ ...currentIds, [activeChat.id]: createdConversation.id as string }))

    return createdConversation.id
  }

  const handleSend = (payload: ComposerSendPayload) => {
    const time = formatMessageTime()
    const userId = Date.now()
    const assistantId = userId + 1

    setMessagesByChat((currentMessagesByChat) => {
      const currentMessages = currentMessagesByChat[activeChat.id] ?? initialMessages

      return {
        ...currentMessagesByChat,
        [activeChat.id]: [
          ...currentMessages,
          { id: userId, role: 'user', text: payload.message, time, attachments: payload.attachments },
          { id: assistantId, role: 'assistant', text: assistantThinkingText, time, activities: [], timelineParts: [], streaming: true },
        ],
      }
    })

    void (async () => {
      try {
        const conversationId = await ensureConversationId()

        if (!conversationId) {
          updateAssistantMessage(assistantId, backendUnavailableReply)
          return
        }

        const result = await sendConversationMessage({
          conversationId,
          text: payload.message,
          approvalMode: payload.approvalMode,
          modelId: payload.modelId,
          goalId: payload.goalId,
        })

        if (!result) {
          updateAssistantMessage(assistantId, backendUnavailableReply)
          return
        }

        const resultThreadId = result.threadId ?? conversationId
        refreshActiveChatTitle(resultThreadId)

        const immediateText = result.assistantMessage?.text ?? result.finalText

        if (immediateText && !result.runId) {
          updateAssistantMessage(assistantId, immediateText)
        }

        if (!result.runId) {
          if (!immediateText) {
            updateAssistantMessage(assistantId, backendUnavailableReply)
          }
          return
        }

        let sawDelta = false

        streamRun(resultThreadId, result.runId, {
          onDelta: (delta) => {
            sawDelta = true
            enqueueSmoothAssistantText(assistantId, delta)
          },
          onEvent: (event) => handleRunEvent(event, assistantId),
          onDone: () => {
            completeSmoothAssistantText(assistantId)
            if (!sawDelta && immediateText) {
              updateAssistantMessage(assistantId, immediateText)
            }
            refreshActiveChatTitle(resultThreadId)
          },
          onError: () => {
            completeSmoothAssistantText(assistantId)
            if (!sawDelta) {
              updateAssistantMessage(assistantId, immediateText || backendUnavailableReply)
            }
            refreshActiveChatTitle(resultThreadId)
          },
        })
      } catch {
        updateAssistantMessage(assistantId, backendUnavailableReply)
      }
    })()
  }

  return (
    <main className="main-chat">
      <header className="chat-header">
        <div className="conversation-tab">
          <MessagesSquare size={16} />
          <span>{activeChat.title}</span>
        </div>
        <div className="chat-more-wrap">
          <button
            className={`icon-ghost chat-more-button ${chatMenuOpen ? 'active' : ''}`}
            type="button"
            aria-label={`${activeChat.title}\u66f4\u591a`}
            aria-haspopup="menu"
            aria-expanded={chatMenuOpen}
            onClick={() => setChatMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={17} />
          </button>

          <AnimatePresence>
            {chatMenuOpen ? (
              <motion.div
                className="chat-action-menu"
                role="menu"
                initial={{ opacity: 1, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 1, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
              >
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><Pin size={14} />{"\u7f6e\u9876\u5bf9\u8bdd"}</span>
                  <kbd>Ctrl+Alt+P</kbd>
                </button>
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><Edit3 size={14} />{"\u91cd\u547d\u540d\u5bf9\u8bdd"}</span>
                  <kbd>Ctrl+Alt+R</kbd>
                </button>
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><Archive size={14} />{"\u5f52\u6863\u5bf9\u8bdd"}</span>
                  <kbd>Ctrl+Shift+A</kbd>
                </button>
                <div className="chat-menu-divider" />
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><MessageSquarePlus size={14} />{"\u6253\u5f00\u4fa7\u8fb9\u804a\u5929"}</span>
                  <kbd>Ctrl+Alt+S</kbd>
                </button>
                <button className="chat-menu-item has-submenu" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><Copy size={14} />{"\u590d\u5236"}</span>
                  <ChevronRight size={14} />
                </button>
                <button className="chat-menu-item has-submenu" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><GitBranch size={14} />{"\u5206\u652f"}</span>
                  <ChevronRight size={14} />
                </button>
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><Clock size={14} />{"\u6dfb\u52a0\u81ea\u52a8\u5316..."}</span>
                </button>
                <div className="chat-menu-divider" />
                <button className="chat-menu-item" type="button" role="menuitem" onClick={() => setChatMenuOpen(false)}>
                  <span><ExternalLink size={14} />{"\u5728\u65b0\u7a97\u53e3\u4e2d\u6253\u5f00"}</span>
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </header>

      <section className="chat-canvas" aria-label={`${activeChat.title}\u5185\u5bb9`}>
        <ChatTranscript messages={messages} />

        <PendingApprovalStack approvals={visiblePendingApprovals} onDecision={handleApprovalDecision} />

        <Composer
          onSend={handleSend}
          goal={attachedGoal}
          onCreateGoal={handleCreateGoal}
          onToggleGoalPaused={handleToggleGoalPaused}
          onContinueGoal={handleContinueGoal}
          onClearGoal={handleClearGoal}
          contextUsage={contextUsage}
        />
      </section>
    </main>
  )
}

function ResizeHandle({
  disabled,
  label,
  onPointerDown,
}: {
  disabled?: boolean
  label: string
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={`pane-resizer ${disabled ? 'disabled' : ''}`}
      aria-label={label}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={disabled ? undefined : onPointerDown}
    >
      <span className="resize-line" />
    </div>
  )
}

function RightTools({
  collapsed,
  expanded,
  onToggle,
  onExpandToggle,
}: {
  collapsed: boolean
  expanded: boolean
  onToggle: () => void
  onExpandToggle: () => void
}) {
  return (
    <aside
      className={`right-pane ${collapsed ? 'collapsed' : ''} ${expanded ? 'expanded' : ''}`}
      aria-label="右侧区域"
    >
      {collapsed ? (
        <button className="right-collapse-button right-collapse-button-collapsed" type="button" aria-label="展开右侧栏" onClick={onToggle}>
          <ChevronLeft size={16} />
        </button>
      ) : (
        <>
          <header className="right-header">
            <div className="right-tab">
              <PanelRight size={16} />
              <span>工具</span>
            </div>
            <div className="right-header-actions">
              <button
                className={`expand-panel-button ${expanded ? 'active' : ''}`}
                type="button"
                aria-label={expanded ? '收起面板' : '展开面板'}
                aria-pressed={expanded}
                title={expanded ? '收起面板' : '展开面板'}
                onClick={onExpandToggle}
              >
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button className="right-collapse-button" type="button" aria-label="折叠右侧栏" onClick={onToggle}>
                <ChevronRight size={16} />
              </button>
            </div>
          </header>
          <section className="right-canvas">
            <div className="tool-stack">
              {rightTools.map((tool) => {
                const Icon = tool.icon

                return (
                  <button className="tool-button" type="button" key={tool.label}>
                    <Icon size={17} />
                    <span>{tool.label}</span>
                    <Code2 size={13} className="tool-hint" />
                  </button>
                )
              })}
            </div>
          </section>
        </>
      )}
    </aside>
  )
}


const heartbeatTasks = [
  {
    name: "\u6bcf\u65e5\u5929\u6c14\u9884\u62a5",
    schedule: "\u6bcf\u5929 07:30",
    summary: "\u83b7\u53d6\u5929\u6c14\u9884\u62a5\u5e76\u6574\u7406\u6458\u8981",
    target: "\u98de\u4e66\u7fa4\uff1a\u5929\u6c14\u64ad\u62a5\u7fa4",
    icon: Bell,
  },
  {
    name: "\u9879\u76ee\u65e5\u62a5",
    schedule: "\u6bcf\u5929 09:00",
    summary: "\u6c47\u603b\u9879\u76ee\u8fdb\u5c55\u5e76\u63d0\u9192\u98ce\u9669",
    target: "PandoShare Agent",
    icon: Calendar,
  },
  {
    name: "Loop \u68c0\u67e5",
    schedule: "\u6bcf\u5c0f\u65f6 00 \u5206",
    summary: "\u68c0\u67e5 Loop \u5b88\u62a4\u4efb\u52a1\u548c\u56de\u653e\u72b6\u6001",
    target: "Agent Runtime",
    icon: Activity,
  },
  {
    name: "Gateway \u961f\u5217\u68c0\u67e5",
    schedule: "\u6bcf 15 \u5206\u949f",
    summary: "\u626b\u63cf\u4efb\u52a1\u961f\u5217\u5361\u6b7b\u548c\u5931\u8d25\u91cd\u8bd5",
    target: "Gateway Queue",
    icon: ShieldCheck,
  },
]

const heartbeatHistory = [
  { time: '2026-06-22 11:30:12', status: "\u6210\u529f", duration: '18.6s', summary: "\u5df2\u83b7\u53d6 3 \u4e2a\u57ce\u5e02\u5929\u6c14\uff0c\u5df2\u53d1\u9001\u5230\u98de\u4e66\u7fa4" },
  { time: '2026-06-22 07:30:11', status: "\u6210\u529f", duration: '16.2s', summary: "\u5df2\u83b7\u53d6 3 \u4e2a\u57ce\u5e02\u5929\u6c14\uff0c\u5df2\u53d1\u9001\u5230\u98de\u4e66\u7fa4" },
  { time: '2026-06-21 07:30:10', status: "\u6210\u529f", duration: '17.4s', summary: "\u5df2\u83b7\u53d6 3 \u4e2a\u57ce\u5e02\u5929\u6c14\uff0c\u5df2\u53d1\u9001\u5230\u98de\u4e66\u7fa4" },
  { time: '2026-06-20 07:30:09', status: "\u5931\u8d25", duration: '--', summary: "\u83b7\u53d6\u5929\u6c14\u6570\u636e\u8d85\u65f6" },
]

const heartbeatExceptions = [
  { name: "\u9879\u76ee\u65e5\u62a5", type: "\u6267\u884c\u5931\u8d25", time: '2026-06-22 09:00:15', status: "\u5931\u8d25" },
  { name: "Gateway \u961f\u5217\u68c0\u67e5", type: "\u4efb\u52a1\u5361\u4f4f", time: '2026-06-22 10:10:03', status: "\u5361\u4f4f" },
]

type HeartbeatSection = 'create' | 'tasks' | 'history' | 'exceptions'

const heartbeatSections: Array<{ id: HeartbeatSection; label: string; icon: IconType }> = [
  { id: 'create', label: "\u65b0\u5efa\u5b9a\u65f6\u4efb\u52a1", icon: Plus },
  { id: 'tasks', label: "\u5b9a\u65f6\u4efb\u52a1\u5217\u8868", icon: Calendar },
  { id: 'history', label: "\u8fd0\u884c\u5386\u53f2", icon: History },
  { id: 'exceptions', label: "\u5f02\u5e38\u4e0e\u6062\u590d", icon: AlertTriangle },
]


type HeartbeatTask = {
  id?: string
  name: string
  schedule: string
  summary: string
  target: string
  status?: string
  lastRunAt?: string
  nextRunAt?: string
  icon: IconType
}

type HeartbeatHistoryRow = {
  id?: string
  jobId?: string
  runId?: string
  time: string
  status: string
  duration: string
  summary: string
}

type HeartbeatExceptionRow = {
  id?: string
  jobId?: string
  runId?: string
  name: string
  type: string
  time: string
  status: string
}

const heartbeatIconSet = [Bell, Calendar, Activity, ShieldCheck]

const withHeartbeatIcon = (task: Omit<HeartbeatTask, 'icon'>, index: number): HeartbeatTask => ({
  ...task,
  icon: heartbeatIconSet[index % heartbeatIconSet.length] ?? Bell,
})

const heartbeatStatusLabel = (status?: string) => {
  if (status === 'paused') return '\u5df2\u6682\u505c'
  if (status === 'failed') return '\u5931\u8d25'
  if (status === 'running') return '\u8fd0\u884c\u4e2d'
  return '\u542f\u7528\u4e2d'
}

function HeartbeatTaskListContent({
  tasks,
  onRunTask,
  onPauseTask,
  onDeleteTask,
}: {
  tasks: HeartbeatTask[]
  onRunTask: (task: HeartbeatTask) => void
  onPauseTask: (task: HeartbeatTask) => void
  onDeleteTask: (task: HeartbeatTask) => void
}) {
  const selectedTask = tasks[0] ?? heartbeatTasks[0]
  const SelectedIcon = selectedTask.icon

  return (
    <div className="heartbeat-task-list-view">
      <section className="heartbeat-panel heartbeat-task-panel">
        <div className="heartbeat-panel-heading">
          <h2>{"\u5b9a\u65f6\u4efb\u52a1\u5217\u8868"}</h2>
          <div className="heartbeat-search"><Search size={14} /><input aria-label="Search tasks" placeholder={"\u641c\u7d22\u4efb\u52a1\u540d\u79f0"} /></div>
          <button className="heartbeat-icon-button" type="button" aria-label="Filter tasks"><Filter size={15} /></button>
        </div>

        <div className="heartbeat-task-list">
          {tasks.map((task, index) => {
            const TaskIcon = task.icon

            return (
              <button className={index === 0 ? 'heartbeat-task-card active' : 'heartbeat-task-card'} type="button" key={task.id ?? task.name}>
                <div className="heartbeat-task-main">
                  <TaskIcon size={17} />
                  <div><strong>{task.name}</strong><span><Clock size={13} />{task.schedule}</span></div>
                </div>
                <span className="heartbeat-status-pill"><i />{heartbeatStatusLabel(task.status)}</span>
                <MoreHorizontal size={15} className="heartbeat-card-more" />
              </button>
            )
          })}
        </div>

        <div className="heartbeat-panel-footer">
          <span>{`\u5171 ${tasks.length} \u9879`}</span>
          <div><button type="button"><ChevronLeft size={13} /></button><strong>1</strong><button type="button"><ChevronRight size={13} /></button></div>
        </div>
      </section>

      <section className="heartbeat-panel heartbeat-detail-panel">
        <div className="heartbeat-detail-header">
          <div className="heartbeat-detail-title">
            <span className="heartbeat-large-icon"><SelectedIcon size={24} /></span>
            <div>
              <span className="heartbeat-detail-kicker">{"\u4efb\u52a1\u8be6\u60c5"}</span>
              <h2>{selectedTask.name}</h2>
              <span className="heartbeat-status-pill"><i />{heartbeatStatusLabel(selectedTask.status)}</span>
            </div>
          </div>
        </div>

        <div className="heartbeat-detail-grid">
          <div><span>{"\u6267\u884c\u89c4\u5219"}</span><strong>{selectedTask.schedule}</strong></div>
          <div><span>{"\u72b6\u6001"}</span><strong className="success-text">{heartbeatStatusLabel(selectedTask.status)}</strong></div>
          <div><span>{"\u52a8\u4f5c"}</span><strong>{selectedTask.summary}</strong></div>
          <div><span>{"\u4e0a\u6b21\u8fd0\u884c"}</span><strong>{selectedTask.lastRunAt ?? '2026-06-22 07:30:12'}</strong></div>
          <div><span>{"\u53d1\u9001\u5230"}</span><strong>{selectedTask.target}</strong></div>
          <div><span>{"\u4e0b\u6b21\u8fd0\u884c"}</span><strong>{selectedTask.nextRunAt ?? '2026-06-23 07:30:00'}</strong></div>
        </div>

        <div className="heartbeat-detail-actions">
          <button className="heartbeat-action primary" type="button" onClick={() => onRunTask(selectedTask)}><Play size={14} />{"\u7acb\u5373\u8fd0\u884c"}</button>
          <button className="heartbeat-action" type="button" onClick={() => onPauseTask(selectedTask)}><Pause size={14} />{"\u6682\u505c\u4efb\u52a1"}</button>
          <button className="heartbeat-action" type="button"><Edit3 size={14} />{"\u7f16\u8f91"}</button>
          <button className="heartbeat-action danger" type="button" onClick={() => onDeleteTask(selectedTask)}><Trash2 size={14} />{"\u5220\u9664"}</button>
          <button className="heartbeat-action" type="button"><History size={14} />{"\u67e5\u770b\u5386\u53f2"}</button>
          <button className="heartbeat-action" type="button"><Play size={14} />{"\u67e5\u770b Replay"}</button>
        </div>
      </section>
    </div>
  )
}
function HeartbeatCreateTaskContent({
  onCreateTask,
}: {
  onCreateTask: (input: HeartbeatTaskInput, runNow: boolean) => void
}) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('')
  const [content, setContent] = useState('')
  const [actionType, setActionType] = useState('system_event')
  const [target, setTarget] = useState('PandoShare Agent')
  const [retryCount, setRetryCount] = useState(3)
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(5)

  const resetForm = () => {
    setName('')
    setSchedule('')
    setContent('')
    setActionType('system_event')
    setTarget('PandoShare Agent')
    setRetryCount(3)
    setRetryIntervalMinutes(5)
  }

  const submitTask = (runNow: boolean) => {
    onCreateTask({
      name: name.trim() || '\u672a\u547d\u540d\u4efb\u52a1',
      schedule: schedule.trim() || '0 9 * * *',
      content: content.trim() || name.trim() || '\u5b9a\u65f6\u4efb\u52a1',
      actionType,
      target: target.trim() || 'PandoShare Agent',
      retryCount,
      retryIntervalMinutes,
    }, runNow)
    resetForm()
  }

  return (
    <section className="heartbeat-panel heartbeat-form-panel heartbeat-form-page">
      <h2>{"\u65b0\u5efa\u5b9a\u65f6\u4efb\u52a1"}</h2>
      <div className="heartbeat-form-grid">
        <label><span>{"\u4efb\u52a1\u540d\u79f0"}</span><input placeholder={"\u8bf7\u8f93\u5165\u4efb\u52a1\u540d\u79f0"} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>{"\u6267\u884c\u65b9\u5f0f"}</span><select defaultValue="time"><option value="time">{"\u6309\u65f6\u95f4\u6267\u884c"}</option></select></label>
        <label><span>{"\u6267\u884c\u65f6\u95f4"}</span><input placeholder={"0 9 * * *"} value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label>
        <label><span>{"\u4efb\u52a1\u5185\u5bb9"}</span><textarea placeholder={"\u8bf7\u8f93\u5165\u4efb\u52a1\u5185\u5bb9"} value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <label><span>{"\u52a8\u4f5c\u7c7b\u578b"}</span><select value={actionType} onChange={(event) => setActionType(event.target.value)}><option value="system_event">system_event</option><option value="gateway_message">gateway_message</option><option value="remote_trigger">remote_trigger</option><option value="loop_wake">loop_wake</option></select></label>
        <label><span>{"\u53d1\u9001\u76ee\u6807"}</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="PandoShare Agent">PandoShare Agent</option><option value="Gateway Queue">Gateway Queue</option><option value="Agent Runtime">Agent Runtime</option></select></label>
      </div>
      <div className="heartbeat-retry-row"><span>{"\u5931\u8d25\u91cd\u8bd5"}</span><input type="number" value={retryCount} onChange={(event) => setRetryCount(Number(event.target.value) || 0)} /><span>{"\u6b21\uff0c\u95f4\u9694"}</span><input type="number" value={retryIntervalMinutes} onChange={(event) => setRetryIntervalMinutes(Number(event.target.value) || 0)} /><span>{"\u5206\u949f"}</span></div>
      <div className="heartbeat-form-actions">
        <button className="heartbeat-action" type="button" onClick={resetForm}>{"\u53d6\u6d88"}</button>
        <button className="heartbeat-action" type="button" onClick={() => submitTask(false)}><Save size={14} />{"\u4fdd\u5b58\u4efb\u52a1"}</button>
        <button className="heartbeat-action strong" type="button" onClick={() => submitTask(true)}><Play size={14} />{"\u4fdd\u5b58\u5e76\u7acb\u5373\u8fd0\u884c"}</button>
      </div>
    </section>
  )
}
function HeartbeatHistoryContent({ rows, onRerun }: { rows: HeartbeatHistoryRow[]; onRerun: (row: HeartbeatHistoryRow) => void }) {
  return (
    <section className="heartbeat-panel heartbeat-history-page">
      <div className="heartbeat-table-title"><h2>{"\u8fd0\u884c\u5386\u53f2"}</h2></div>
      <table className="heartbeat-table">
        <thead><tr><th>{"\u8fd0\u884c\u65f6\u95f4"}</th><th>{"\u72b6\u6001"}</th><th>{"\u6267\u884c\u65f6\u957f"}</th><th>{"\u7ed3\u679c\u6458\u8981"}</th><th>{"\u64cd\u4f5c"}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={(row.id ?? row.time) + '-' + row.status}>
              <td>{row.time}</td>
              <td><span className={row.status === '\u6210\u529f' || row.status === 'success' || row.status === 'completed' ? 'heartbeat-result success' : 'heartbeat-result failed'}>{row.status}</span></td>
              <td>{row.duration}</td>
              <td>{row.summary}</td>
              <td>
                <div className="heartbeat-history-actions">
                  <button type="button">{"\u67e5\u770b\u65e5\u5fd7"}</button>
                  <button type="button">Replay</button>
                  <button type="button" onClick={() => onRerun(row)}>{"\u91cd\u65b0\u8fd0\u884c"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
function HeartbeatExceptionsContent({ items, onRetry }: { items: HeartbeatExceptionRow[]; onRetry: (item: HeartbeatExceptionRow) => void }) {
  return (
    <section className="heartbeat-panel heartbeat-exception-panel heartbeat-exception-page">
      <div className="heartbeat-table-title"><h2>{"\u5f02\u5e38\u4e0e\u6062\u590d"}</h2><span>{items.length}</span></div>
      <div className="heartbeat-exception-list">
        {items.map((item) => (
          <article className="heartbeat-exception-card" key={item.id ?? item.name}>
            <div><AlertTriangle size={15} /><strong>{item.name}</strong><span>{item.time}</span></div>
            <div><span className="heartbeat-result failed">{item.type}</span><span className="heartbeat-result stuck">{item.status}</span></div>
            <div className="heartbeat-exception-actions"><button type="button" onClick={() => onRetry(item)}><RotateCcw size={13} />{"\u91cd\u8bd5"}</button><button type="button">{"\u8df3\u8fc7\u672c\u6b21"}</button><button type="button">{"\u6807\u8bb0\u5df2\u5904\u7406"}</button><button type="button">Replay</button></div>
          </article>
        ))}
      </div>
    </section>
  )
}
function HeartbeatWorkspace() {
  const [section, setSection] = useState<HeartbeatSection>('tasks')
  const [heartbeatRunning, setHeartbeatRunning] = useState(true)
  const [tasks, setTasks] = useState<HeartbeatTask[]>(heartbeatTasks)
  const [historyRows, setHistoryRows] = useState<HeartbeatHistoryRow[]>(heartbeatHistory)
  const [exceptionRows, setExceptionRows] = useState<HeartbeatExceptionRow[]>(heartbeatExceptions)
  const activeSection = heartbeatSections.find((item) => item.id === section) ?? heartbeatSections[1]

  const refreshHeartbeat = async () => {
    const snapshot = await loadHeartbeatSnapshot()

    if (!snapshot) {
      return
    }

    if (typeof snapshot.running === 'boolean') {
      setHeartbeatRunning(snapshot.running)
    }

    if (snapshot.tasks && snapshot.tasks.length > 0) {
      setTasks(snapshot.tasks.map((task, index) => withHeartbeatIcon(task, index)))
    }

    if (snapshot.history && snapshot.history.length > 0) {
      setHistoryRows(snapshot.history)
    }

    if (snapshot.exceptions && snapshot.exceptions.length > 0) {
      setExceptionRows(snapshot.exceptions)
    }
  }

  useEffect(() => {
    void refreshHeartbeat()
  }, [])

  const toggleHeartbeatRunning = () => {
    const nextRunning = !heartbeatRunning

    setHeartbeatRunning(nextRunning)
    void setHeartbeatRunningBackend(nextRunning).then((updated) => {
      if (updated) {
        void refreshHeartbeat()
      }
    })
  }

  const handleRunTask = (task: HeartbeatTask) => {
    if (!task.id) {
      return
    }

    void runScheduledTask(task.id).then(() => refreshHeartbeat())
  }

  const handlePauseTask = (task: HeartbeatTask) => {
    if (!task.id) {
      return
    }

    void pauseScheduledTask(task.id, task.status !== 'paused').then(() => refreshHeartbeat())
  }

  const handleDeleteTask = (task: HeartbeatTask) => {
    if (!task.id) {
      return
    }

    void deleteScheduledTask(task.id).then((deleted) => {
      if (deleted) {
        setTasks((currentTasks) => currentTasks.filter((currentTask) => currentTask.id !== task.id))
      }
      void refreshHeartbeat()
    })
  }

  const handleCreateTask = (input: HeartbeatTaskInput, runNow: boolean) => {
    void createScheduledTask(input, runNow).then((createdTask) => {
      if (createdTask) {
        setTasks((currentTasks) => [withHeartbeatIcon(createdTask, currentTasks.length), ...currentTasks])
        setSection('tasks')
      }
      void refreshHeartbeat()
    })
  }

  const handleRerunHistory = (row: HeartbeatHistoryRow) => {
    if (row.jobId) {
      void runScheduledTask(row.jobId).then(() => refreshHeartbeat())
    }
  }

  const handleRetryException = (item: HeartbeatExceptionRow) => {
    if (item.jobId) {
      void runScheduledTask(item.jobId).then(() => refreshHeartbeat())
    }
  }

  return (
    <main className="heartbeat-workspace" aria-label="Heartbeat task center">
      <section className="heartbeat-shell heartbeat-settings-shell">
        <aside className="heartbeat-app-nav" aria-label="Heartbeat sections">
          <div className="heartbeat-app-nav-head">
            <div className="heartbeat-title-block">
              <div className="heartbeat-mark"><HeartPulse size={18} /></div>
              <div>
                <h1>{"\u5fc3\u8df3\u4efb\u52a1\u4e2d\u5fc3"}</h1>
                <span className={heartbeatRunning ? 'heartbeat-live' : 'heartbeat-live paused'}><i />{heartbeatRunning ? "\u5fc3\u8df3\u8fd0\u884c\u4e2d" : "\u5fc3\u8df3\u5df2\u6682\u505c"}</span>
              </div>
            </div>
            <div className="heartbeat-search heartbeat-nav-search"><Search size={14} /><input aria-label="Search heartbeat settings" placeholder={"\u641c\u7d22\u5fc3\u8df3..."} /></div>
          </div>

          <nav className="heartbeat-section-nav">
            {heartbeatSections.map((item) => {
              const Icon = item.icon

              return (
                <button className={section === item.id ? 'heartbeat-section-button active' : 'heartbeat-section-button'} type="button" onClick={() => setSection(item.id)} key={item.id}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="heartbeat-section-content">
          <header className="heartbeat-topbar heartbeat-section-topbar">
            <div className="heartbeat-content-title">
              <h2>{activeSection.label}</h2>
            </div>
            <div className="heartbeat-actions">
              <button
                className="heartbeat-action primary"
                type="button"
                aria-pressed={!heartbeatRunning}
                onClick={toggleHeartbeatRunning}
              >
                {heartbeatRunning ? <Pause size={14} /> : <Play size={14} />}
                {heartbeatRunning ? "\u6682\u505c\u5fc3\u8df3" : "\u7acb\u5373\u5524\u9192"}
              </button>
              <button className="heartbeat-action" type="button" onClick={() => void refreshHeartbeat()}><RefreshCw size={14} />{"\u5237\u65b0"}</button>
            </div>
          </header>

          <div className="heartbeat-section-body">
            {section === 'create' ? <HeartbeatCreateTaskContent onCreateTask={handleCreateTask} /> : null}
            {section === 'tasks' ? <HeartbeatTaskListContent tasks={tasks} onRunTask={handleRunTask} onPauseTask={handlePauseTask} onDeleteTask={handleDeleteTask} /> : null}
            {section === 'history' ? <HeartbeatHistoryContent rows={historyRows} onRerun={handleRerunHistory} /> : null}
            {section === 'exceptions' ? <HeartbeatExceptionsContent items={exceptionRows} onRetry={handleRetryException} /> : null}
          </div>
        </section>
      </section>
    </main>
  )
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function App() {
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightExpanded, setRightExpanded] = useState(false)
  const [leftWidth, setLeftWidth] = useState(292)
  const [rightWidth, setRightWidth] = useState(292)
  const [rightWidthBeforeExpand, setRightWidthBeforeExpand] = useState(292)
  const [activeChat, setActiveChat] = useState<ActiveChat>(() => createSidebarActiveChat('\u65b0\u5bf9\u8bdd'))
  const [activeView, setActiveView] = useState<WorkspaceView>('chat')
  const [activeSetting, setActiveSetting] = useState('mcp')

  const getMaxRightWidth = () => {
    const leftPaneWidth = leftCollapsed ? 74 : leftWidth

    return Math.max(240, window.innerWidth - leftPaneWidth)
  }

  const startLeftResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = leftWidth
    const rightPaneWidth = rightCollapsed ? 56 : rightWidth
    const maxLeftWidth = Math.max(220, Math.min(420, window.innerWidth - rightPaneWidth - 576))

    document.body.classList.add('is-resizing')

    const handleMove = (moveEvent: PointerEvent) => {
      setLeftWidth(clamp(startWidth + moveEvent.clientX - startX, 220, maxLeftWidth))
    }

    const handleUp = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }

  const startRightResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = rightWidth
    const maxRightWidth = getMaxRightWidth()

    document.body.classList.add('is-resizing')
    setRightExpanded(false)

    const handleMove = (moveEvent: PointerEvent) => {
      setRightWidth(clamp(startWidth - (moveEvent.clientX - startX), 240, maxRightWidth))
    }

    const handleUp = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
  }

  const shellStyle = {
    '--left-width': leftCollapsed ? '74px' : `${leftWidth}px`,
    '--right-width': rightCollapsed ? '56px' : `${rightWidth}px`,
  } as CSSProperties

  const openChat = (chat: ActiveChat) => {
    setActiveChat(chat)
    setActiveView('chat')
  }

  const handleChatTitleUpdate = (chatId: string, threadId: string, title: string) => {
    setActiveChat((currentChat) =>
      currentChat.id === chatId || currentChat.conversationId === threadId
        ? { ...currentChat, title, conversationId: currentChat.conversationId ?? threadId }
        : currentChat,
    )
  }

  const toggleRightCollapsed = () => {
    if (!rightCollapsed) {
      if (rightExpanded) {
        setRightWidth(rightWidthBeforeExpand)
      }

      setRightExpanded(false)
    }

    setRightCollapsed((value) => !value)
  }

  const toggleRightExpanded = () => {
    if (rightExpanded) {
      setRightWidth(rightWidthBeforeExpand)
      setRightExpanded(false)
      return
    }

    setRightWidthBeforeExpand(rightWidth)
    setRightCollapsed(false)
    setRightWidth(getMaxRightWidth())
    setRightExpanded(true)
  }

  return (
    <div className={`app-shell ${rightExpanded && activeView === 'chat' ? 'right-expanded' : ''} ${activeView === 'heartbeat' ? 'heartbeat-active' : ''} ${activeView === 'settings' ? 'settings-active' : ''} ${activeView === 'plugins' ? 'plugins-active' : ''}`} style={shellStyle}>
      <LeftSidebar
        collapsed={leftCollapsed}
        activeChatId={activeChat.id}
        activeView={activeView}
        activeSetting={activeSetting}
        onOpenChat={openChat}
        onOpenHeartbeat={() => setActiveView('heartbeat')}
        onOpenSettings={() => setActiveView('settings')}
        onCloseSettings={() => setActiveView('chat')}
        onOpenPlugins={() => setActiveView('plugins')}
        onSettingChange={setActiveSetting}
        onToggle={() => setLeftCollapsed((value) => !value)}
      />
      <ResizeHandle disabled={leftCollapsed} label="Adjust left sidebar width" onPointerDown={startLeftResize} />
      {activeView === 'settings' ? (
        <SettingsWorkspace activeSetting={activeSetting} />
      ) : activeView === 'plugins' ? (
        <PluginsWorkspace />
      ) : activeView === 'heartbeat' ? (
        <HeartbeatWorkspace />
      ) : (
        <>
          <MainChat activeChat={activeChat} onChatTitleUpdate={handleChatTitleUpdate} />
          <ResizeHandle disabled={rightCollapsed} label="Adjust right sidebar width" onPointerDown={startRightResize} />
          <RightTools
            collapsed={rightCollapsed}
            expanded={rightExpanded}
            onToggle={toggleRightCollapsed}
            onExpandToggle={toggleRightExpanded}
          />
        </>
      )}
    </div>
  )
}

export default App
