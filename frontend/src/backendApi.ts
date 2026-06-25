export type UiProjectChat = {
  id?: string
  name: string
  pinned?: boolean
}

export type UiProject = {
  id?: string
  name: string
  chats: UiProjectChat[]
}

export type UiConversation = {
  id?: string
  name: string
  pinned?: boolean
}

export type UiPinnedItem = {
  id: string
  kind: 'project' | 'chat'
  sourceId?: string
  sourceName: string
  label: string
}

export type UiModelGroup = {
  provider: string
  models: string[]
}

export type UiChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  time: string
}

export type WorkspaceSnapshot = {
  pinnedItems?: UiPinnedItem[]
  projects?: UiProject[]
  chats?: UiConversation[]
  modelGroups?: UiModelGroup[]
}

export type SendMessageInput = {
  conversationId: string
  text: string
  approvalMode?: string
  modelId?: string
  goalId?: string
}

export type SendMessageResult = {
  runId?: string
  threadId?: string
  userMessage?: UiChatMessage
  assistantMessage?: UiChatMessage
  finalText?: string
}

export type AgentRunEvent = Record<string, unknown>

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'reject'

export type ApprovalDecisionResult = {
  ok?: boolean
  approvalId?: string
  decision?: ApprovalDecision
}

export type PendingApprovalSummary = {
  approvalId: string
}

export type ContinueGoalResult = {
  ok?: boolean
  runId?: string
  threadId?: string
  summary?: UiGoalSummary
}

export type UiGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export type UiGoalSummary = {
  id: string
  threadId?: string
  goalId?: string
  title: string
  objective: string
  status: UiGoalStatus
  tokenBudget?: number
  tokensUsed?: number
  timeUsedSeconds?: number
  progressPercent: number
  requirementCount: number
  completedRequirementCount: number
  blockerCount: number
  updatedAtMs?: number
}

export type HeartbeatTaskInput = {
  name: string
  schedule: string
  content: string
  actionType: string
  target: string
  retryCount: number
  retryIntervalMinutes: number
}

export type UiHeartbeatTask = {
  id?: string
  name: string
  schedule: string
  summary: string
  target: string
  status?: string
  lastRunAt?: string
  nextRunAt?: string
}

export type UiHeartbeatHistoryRow = {
  id?: string
  jobId?: string
  runId?: string
  time: string
  status: string
  duration: string
  summary: string
}

export type UiHeartbeatException = {
  id?: string
  jobId?: string
  runId?: string
  name: string
  type: string
  time: string
  status: string
}

export type HeartbeatSnapshot = {
  running?: boolean
  tasks?: UiHeartbeatTask[]
  history?: UiHeartbeatHistoryRow[]
  exceptions?: UiHeartbeatException[]
}

type AnyRecord = Record<string, unknown>

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const unwrapData = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value
  }

  if ('data' in value) {
    return value.data
  }

  return value
}

const firstArray = (...values: unknown[]): unknown[] => {
  for (const value of values) {
    const rows = asArray(value)

    if (rows.length > 0) {
      return rows
    }
  }

  return []
}

const unwrapOkRecord = (value: unknown): AnyRecord | undefined => {
  const data = unwrapData(value)

  return isRecord(data) ? data : undefined
}

const fallbackApiBase = (() => {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const value = env?.VITE_PANDOSHARE_API_FALLBACK?.trim()

  return value && value !== window.location.origin ? value.replace(/\/+$/, '') : undefined
})()

function apiRequestUrls(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return [url]
  }

  const urls = [url]

  if (fallbackApiBase && url.startsWith('/api/')) {
    urls.push(`${fallbackApiBase}${url}`)
  }

  return urls
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  for (const requestUrl of apiRequestUrls(url)) {
    try {
      const response = await fetch(requestUrl, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      })

      if (!response.ok) {
        continue
      }

      if (response.status === 204) {
        return undefined
      }

      return (await response.json()) as T
    } catch {
      continue
    }
  }

  return undefined
}

const nowTime = () => {
  const now = new Date()

  return `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
}

const formatDateTime = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)

    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getFullYear()
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      const dd = String(date.getDate()).padStart(2, '0')
      const hh = String(date.getHours()).padStart(2, '0')
      const mi = String(date.getMinutes()).padStart(2, '0')
      const ss = String(date.getSeconds()).padStart(2, '0')

      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
    }
  }

  return undefined
}

const durationText = (value: unknown): string => {
  const ms = asNumber(value)

  if (ms === undefined) {
    return '--'
  }

  return `${(ms / 1000).toFixed(1)}s`
}

const stableUiMessageId = (value: Record<string, unknown>): number => {
  const numeric = asNumber(value.id)

  if (numeric !== undefined) {
    return numeric
  }

  const createdAtMs = asNumber(value.createdAtMs)
  const seed = asString(value.id) ?? `${asString(value.role) ?? 'message'}:${asString(value.content) ?? asString(value.text) ?? ''}:${createdAtMs ?? ''}`
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }

  if (createdAtMs !== undefined) {
    return createdAtMs + Math.abs(hash % 1000)
  }

  return Math.abs(hash) + 1_000_000
}

const normalizeMessage = (value: unknown): UiChatMessage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const role = value.role === 'user' || value.role === 'assistant' ? value.role : undefined
  const text = asString(value.text) ?? asString(value.content) ?? asString(value.message)

  if (!role || !text) {
    return undefined
  }

  return {
    id: stableUiMessageId(value),
    role,
    text,
    time: asString(value.time) ?? formatDateTime(value.createdAtMs) ?? nowTime(),
  }
}

const normalizeModels = (value: unknown): UiModelGroup[] | undefined => {
  const data = unwrapData(value)
  const source = isRecord(data) ? data.modelGroups ?? data.providers ?? data.models : data
  const rows = asArray(source)

  if (rows.length === 0) {
    return undefined
  }

  const groups = rows
    .map((row): UiModelGroup | undefined => {
      if (typeof row === 'string') {
        return { provider: 'Custom', models: [row] }
      }

      if (!isRecord(row)) {
        return undefined
      }

      const provider = asString(row.provider) ?? asString(row.name) ?? asString(row.id)
      const models = asArray(row.models)
        .map((model) => {
          if (typeof model === 'string') {
            return model
          }

          if (isRecord(model)) {
            return asString(model.label) ?? asString(model.name) ?? asString(model.id)
          }

          return undefined
        })
        .filter((model): model is string => Boolean(model))

      if (!provider || models.length === 0) {
        return undefined
      }

      return { provider, models }
    })
    .filter((group): group is UiModelGroup => Boolean(group))

  return groups.length > 0 ? groups : undefined
}

const normalizeConversation = (value: unknown): UiConversation | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  const id =
    asString(value.id) ??
    asString(value.conversationId) ??
    asString(value.threadId) ??
    asString(metadata?.threadId)
  const name = asString(value.title) ?? asString(value.name) ?? asString(metadata?.title) ?? id

  if (!name) {
    return undefined
  }

  return { id, name, pinned: Boolean(value.pinned) }
}

const normalizeGoalSummary = (value: unknown): UiGoalSummary | undefined => {
  const data = unwrapData(value)
  const source = isRecord(data)
    ? isRecord(data.summary)
      ? data.summary
      : isRecord(data.goal)
        ? data.goal
        : data
    : value

  if (!isRecord(source)) {
    return undefined
  }

  const metadata = isRecord(source.metadata) ? source.metadata : source
  const id = asString(metadata.goalId) ?? asString(source.goalId) ?? asString(source.id) ?? asString(metadata.threadId) ?? asString(source.threadId)
  const objective = asString(source.objective) ?? asString(metadata.objective) ?? asString(metadata.title)
  const title = asString(metadata.title) ?? asString(source.title) ?? objective ?? id
  const rawStatus = asString(metadata.status) ?? asString(source.status) ?? 'active'
  const status = normalizeGoalStatus(rawStatus)

  if (!id || !title || !objective) {
    return undefined
  }

  return {
    id,
    threadId: asString(metadata.threadId) ?? asString(source.threadId),
    goalId: asString(metadata.goalId) ?? asString(source.goalId) ?? id,
    title,
    objective,
    status,
    tokenBudget: asNumber(metadata.tokenBudget) ?? asNumber(source.tokenBudget),
    tokensUsed: asNumber(metadata.tokensUsed) ?? asNumber(source.tokensUsed),
    timeUsedSeconds: asNumber(metadata.timeUsedSeconds) ?? asNumber(source.timeUsedSeconds),
    progressPercent: asNumber(metadata.progressPercent) ?? asNumber(source.progressPercent) ?? 0,
    requirementCount: asNumber(source.requirementCount) ?? asNumber(metadata.requirementCount) ?? 0,
    completedRequirementCount: asNumber(metadata.completedRequirementCount) ?? 0,
    blockerCount: asNumber(metadata.blockerCount) ?? 0,
    updatedAtMs: asNumber(metadata.updatedAtMs),
  }
}

const normalizeGoalStatus = (status: string): UiGoalStatus => {
  switch (status) {
    case 'paused':
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
    case 'complete':
      return status
    case 'usage_limited':
      return 'usageLimited'
    case 'budget_limited':
      return 'budgetLimited'
    case 'completed':
      return 'complete'
    default:
      return 'active'
  }
}

const normalizeProject = (value: unknown): UiProject | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const id = asString(value.id) ?? asString(value.projectId)
  const name = asString(value.title) ?? asString(value.name) ?? id

  if (!name) {
    return undefined
  }

  const chats = asArray(value.chats ?? value.conversations)
    .map(normalizeConversation)
    .filter((chat): chat is UiConversation => Boolean(chat))
    .map((chat) => ({ id: chat.id, name: chat.name, pinned: Boolean(chat.pinned) }))

  return { id, name, chats }
}

const normalizePinnedItem = (value: unknown): UiPinnedItem | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const rawKind = asString(value.kind) ?? asString(value.type)
  const kind = rawKind === 'project' ? 'project' : rawKind === 'conversation' || rawKind === 'chat' ? 'chat' : undefined
  const sourceId = asString(value.sourceId) ?? asString(value.targetId) ?? asString(value.id)
  const sourceName = asString(value.sourceName) ?? asString(value.title) ?? asString(value.name) ?? sourceId

  if (!kind || !sourceName) {
    return undefined
  }

  return {
    id: `${kind}:${sourceId ?? sourceName}`,
    kind,
    sourceId,
    sourceName,
    label: asString(value.label) ?? `Pinned ${sourceName}`,
  }
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | undefined> {
  const response = await jsonRequest<unknown>('/api/workspace')
  const data = unwrapOkRecord(response)

  if (data) {
    return {
      pinnedItems: asArray(data.pinnedItems ?? data.pinned).map(normalizePinnedItem).filter(Boolean) as UiPinnedItem[],
      projects: asArray(data.projects).map(normalizeProject).filter(Boolean) as UiProject[],
      chats: asArray(data.conversations ?? data.chats).map(normalizeConversation).filter(Boolean) as UiConversation[],
      modelGroups: normalizeModels(data.modelGroups ?? data.models ?? data.providers),
    }
  }

  const threadResponse = await jsonRequest<unknown>('/api/threads')
  const threads = firstArray(unwrapData(threadResponse), isRecord(threadResponse) ? threadResponse.threads : undefined)
    .map(normalizeConversation)
    .filter((chat): chat is UiConversation => Boolean(chat))

  if (threads.length === 0) {
    return undefined
  }

  return { chats: threads }
}

export async function loadThreadGoal(threadId: string): Promise<UiGoalSummary | undefined> {
  const response = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`)

  return normalizeGoalSummary(response)
}

export async function setThreadGoal(
  threadId: string,
  input: { objective?: string; status?: UiGoalStatus; tokenBudget?: number },
): Promise<UiGoalSummary | undefined> {
  const response = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return normalizeGoalSummary(response)
}

export async function clearThreadGoal(threadId: string): Promise<UiGoalSummary | undefined> {
  const response = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
    method: 'DELETE',
  })

  return normalizeGoalSummary(response)
}

export async function continueThreadGoal(threadId: string): Promise<ContinueGoalResult | undefined> {
  const response = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal/continue`, {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
  })
  const data = unwrapData(response)
  if (!isRecord(data)) {
    return undefined
  }

  return {
    ok: data.ok === true,
    runId: asString(data.runId),
    threadId: asString(data.threadId),
    summary: normalizeGoalSummary(data),
  }
}

export async function loadModelGroups(): Promise<UiModelGroup[] | undefined> {
  const response = await jsonRequest<unknown>('/api/models')
  const directModels = normalizeModels(response)

  if (directModels) {
    return directModels
  }

  const settings = unwrapOkRecord(await jsonRequest<unknown>('/api/settings'))
  const catalog = isRecord(settings?.modelSettings) ? settings.modelSettings.catalog : undefined
  const settingsModels = normalizeModels(catalog)

  if (settingsModels) {
    return settingsModels
  }

  const active = isRecord(settings?.modelSettings) ? settings.modelSettings.active : undefined

  if (isRecord(active)) {
    const provider = asString(active.name) ?? asString(active.provider)
    const model = asString(active.model) ?? asString(active.defaultModel)

    if (provider && model) {
      return [{ provider, models: [model] }]
    }
  }

  return undefined
}

export async function createProject(title: string): Promise<UiProject | undefined> {
  const response = await jsonRequest<unknown>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })

  return normalizeProject(unwrapData(response))
}

export async function createConversation(input: {
  title?: string
  scope: { type: 'global' } | { type: 'project'; projectId?: string; projectName?: string }
}): Promise<UiConversation | undefined> {
  const response = await jsonRequest<unknown>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const conversation = normalizeConversation(unwrapData(response))

  if (conversation) {
    return conversation
  }

  const threadResponse = await jsonRequest<unknown>('/api/threads', {
    method: 'POST',
    body: JSON.stringify({ title: input.title }),
  })

  return normalizeConversation(unwrapData(threadResponse))
}

export async function setPinnedItem(input: { kind: 'project' | 'conversation'; id?: string; title?: string }) {
  if (!input.id) {
    return false
  }

  const response = await jsonRequest<unknown>('/api/pins', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return response !== undefined
}

export async function unsetPinnedItem(id?: string) {
  if (!id) {
    return false
  }

  const response = await fetch(`/api/pins/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)

  return Boolean(response?.ok)
}

export async function loadConversationMessages(conversationId?: string): Promise<UiChatMessage[] | undefined> {
  if (!conversationId) {
    return undefined
  }

  const response = await jsonRequest<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)
  const data = unwrapData(response)
  const rows = asArray(isRecord(data) ? data.messages : data)
    .map(normalizeMessage)
    .filter((message): message is UiChatMessage => Boolean(message))

  if (rows.length > 0) {
    return rows
  }

  const threadResponse = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(conversationId)}`)
  const threadData = unwrapData(threadResponse)
  const threadRows = asArray(isRecord(threadData) ? threadData.messages : undefined)
    .map(normalizeMessage)
    .filter((message): message is UiChatMessage => Boolean(message))

  return threadRows.length > 0 ? threadRows : undefined
}

export async function loadConversationEvents(conversationId?: string): Promise<AgentRunEvent[] | undefined> {
  if (!conversationId) {
    return undefined
  }

  const threadResponse = await jsonRequest<unknown>(`/api/threads/${encodeURIComponent(conversationId)}`)
  const threadData = unwrapData(threadResponse)
  const events = asArray(isRecord(threadData) ? threadData.events : undefined)
    .filter((event): event is AgentRunEvent => isRecord(event))

  return events.length > 0 ? events : undefined
}

export async function sendConversationMessage(input: SendMessageInput): Promise<SendMessageResult | undefined> {
  const approvalFields = approvalRequestFields(input.approvalMode)
  const response = await jsonRequest<unknown>(`/api/conversations/${encodeURIComponent(input.conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      text: input.text,
      ...approvalFields,
      modelId: input.modelId,
      goalId: input.goalId,
      stream: true,
    }),
  })
  const data = unwrapData(response)

  if (isRecord(data)) {
    return {
      runId: asString(data.runId) ?? (isRecord(data.run) ? asString(data.run.id) ?? asString(data.run.runId) : undefined),
      threadId: asString(data.threadId) ?? asString(data.conversationId),
      userMessage: normalizeMessage(data.userMessage),
      assistantMessage: normalizeMessage(data.assistantMessage),
      finalText: asString(data.finalText) ?? asString(data.text) ?? asString(data.assistantText),
    }
  }

  const chatResponse = await jsonRequest<unknown>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      threadId: input.conversationId,
      prompt: input.text,
      ...approvalFields,
      modelId: input.modelId,
      goalId: input.goalId,
      stream: true,
    }),
  })
  const chatData = unwrapData(chatResponse)

  if (!isRecord(chatData)) {
    return undefined
  }

  return {
    runId: asString(chatData.runId),
    threadId: asString(chatData.threadId),
    finalText: asString(chatData.finalText) ?? asString(chatData.text) ?? asString(chatData.error),
  }
}

function approvalRequestFields(approvalMode?: string) {
  const normalized = normalizeApprovalMode(approvalMode)

  if (normalized === 'auto_review') {
    return {
      approvalMode: 'auto_review',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    }
  }

  if (normalized === 'full_access') {
    return {
      approvalMode: 'full_access',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    }
  }

  return {
    approvalMode: 'request_approval',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
  }
}

function normalizeApprovalMode(approvalMode?: string) {
  const mode = approvalMode?.trim() ?? ''
  const normalized = mode.toLowerCase().replace(/[\s_]+/g, '-')

  if (['auto-review', 'auto-approve', 'auto'].includes(normalized)) {
    return 'auto_review'
  }

  if (['full-access', 'danger-full-access', 'full', 'trusted'].includes(normalized)) {
    return 'full_access'
  }

  return 'request_approval'
}
export function streamRun(
  threadId: string,
  runId: string | undefined,
  handlers: {
    onDelta: (delta: string) => void
    onEvent?: (event: AgentRunEvent) => void
    onDone: () => void
    onError: (message?: string) => void
  },
) {
  try {
    const eventUrl = `${fallbackApiBase ?? ''}/api/events?threadId=${encodeURIComponent(threadId)}${runId ? `&runId=${encodeURIComponent(runId)}` : ''}`
    const source = new EventSource(eventUrl)
    const seenEventIds = new Set<string>()

    const closeDone = () => {
      handlers.onDone()
      source.close()
    }

    const closeError = (message?: string) => {
      handlers.onError(message)
      source.close()
    }

    const matchesRun = (payload: AnyRecord) => {
      if (!runId) {
        return true
      }

      const payloadRunId = asString(payload.runId)

      return !payloadRunId || payloadRunId === runId
    }

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as unknown

        if (!isRecord(payload)) {
          return
        }

        if (!matchesRun(payload)) {
          return
        }


        const eventId = asString(payload.id)
        if (eventId) {
          if (seenEventIds.has(eventId)) {
            return
          }
          seenEventIds.add(eventId)
        }

        const type = asString(payload.type) ?? asString(payload.event)
        const delta = asString(payload.delta)

        if (type && type !== 'agent_message_delta') {
          handlers.onEvent?.(payload)
        }

        if (type === 'agent_message_delta' && delta) {
          handlers.onDelta(delta)
        }

        if (type && ['run_completed', 'turn_completed', 'web_chat_completed', 'web_goal_completed'].includes(type)) {
          closeDone()
        }

        if (type && ['run_failed', 'turn_failed', 'web_chat_failed', 'web_goal_failed'].includes(type)) {
          closeError(asString(payload.error) ?? asString(payload.message))
        }
      } catch {
        if (event.data) {
          handlers.onDelta(event.data)
        }
      }
    }

    source.onmessage = handleMessage
    source.addEventListener('agent_event', handleMessage as EventListener)
    source.addEventListener('approval_pending', handleMessage as EventListener)
    source.addEventListener('approval_answered', handleMessage as EventListener)
    source.addEventListener('web_chat_completed', handleMessage as EventListener)
    source.addEventListener('web_chat_failed', handleMessage as EventListener)
    source.addEventListener('web_goal_completed', handleMessage as EventListener)
    source.addEventListener('web_goal_failed', handleMessage as EventListener)
    source.onerror = () => {
      closeError()
    }

    return () => source.close()
  } catch {
    handlers.onError()
    return () => {}
  }
}

export async function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
): Promise<ApprovalDecisionResult | undefined> {
  const response = await jsonRequest<unknown>(`/api/approval/${encodeURIComponent(approvalId)}`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
  const data = unwrapOkRecord(response)

  if (!data) {
    return undefined
  }

  return {
    ok: data.ok === true,
    approvalId: asString(data.approvalId) ?? approvalId,
    decision: data.decision === 'approve_once' || data.decision === 'approve_always' || data.decision === 'reject'
      ? data.decision
      : decision,
  }
}

export async function loadPendingApprovals(): Promise<PendingApprovalSummary[] | undefined> {
  const response = await jsonRequest<unknown>('/api/mission-control/approvals')
  const data = unwrapOkRecord(response)
  const pending = isRecord(data?.data) ? data.data.pending : data?.pending

  if (!Array.isArray(pending)) {
    return undefined
  }

  return pending
    .map((item): PendingApprovalSummary | undefined => {
      if (!isRecord(item)) {
        return undefined
      }

      const approvalId = asString(item.approvalId) ?? asString(item.id)

      return approvalId ? { approvalId } : undefined
    })
    .filter((item): item is PendingApprovalSummary => Boolean(item))
}

const scheduleToText = (schedule: unknown): string => {
  if (typeof schedule === 'string') {
    return schedule
  }

  if (!isRecord(schedule)) {
    return 'manual'
  }

  const type = asString(schedule.type)

  if (type === 'daily') {
    return `daily ${asString(schedule.time) ?? ''}`.trim()
  }

  if (type === 'every') {
    return `every ${asNumber(schedule.intervalMs) ?? asString(schedule.interval) ?? ''}`.trim()
  }

  if (type === 'cron') {
    return `cron ${asString(schedule.expression) ?? asString(schedule.cron) ?? ''}`.trim()
  }

  if (type === 'once') {
    return `once ${formatDateTime(schedule.runAtMs) ?? ''}`.trim()
  }

  return type ?? 'manual'
}

const actionSummary = (action: unknown): string => {
  if (typeof action === 'string') {
    return action
  }

  if (!isRecord(action)) {
    return 'Scheduled automation'
  }

  return asString(action.summary) ?? asString(action.type) ?? asString(action.name) ?? 'Scheduled automation'
}

const actionTarget = (job: AnyRecord): string => {
  const delivery = isRecord(job.delivery) ? job.delivery : undefined
  const action = isRecord(job.action) ? job.action : undefined
  const payload = action && isRecord(action.payload) ? action.payload : undefined

  return (
    asString(delivery?.channelId) ??
    asString(delivery?.target) ??
    asString(payload?.channel) ??
    asString(payload?.target) ??
    'PandoShare Agent'
  )
}

const normalizeHeartbeatTask = (value: unknown): UiHeartbeatTask | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const id = asString(value.id) ?? asString(value.jobId) ?? asString(value.taskId)
  const name = asString(value.title) ?? asString(value.name) ?? id

  if (!name) {
    return undefined
  }

  return {
    id,
    name,
    schedule: asString(value.scheduleText) ?? scheduleToText(value.schedule),
    summary: asString(value.summary) ?? actionSummary(value.action ?? value.content),
    target: asString(value.target) ?? actionTarget(value),
    status: asString(value.status),
    lastRunAt: formatDateTime(value.lastRunAt ?? value.lastRunAtMs),
    nextRunAt: formatDateTime(value.nextRunAt ?? value.nextRunAtMs),
  }
}

const normalizeHeartbeatRun = (value: unknown): UiHeartbeatHistoryRow | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const runId = asString(value.runId) ?? asString(value.id)

  return {
    id: runId,
    runId,
    jobId: asString(value.jobId),
    time: formatDateTime(value.startedAt ?? value.startedAtMs ?? value.createdAtMs) ?? nowTime(),
    status: asString(value.status) ?? 'unknown',
    duration: durationText(value.durationMs),
    summary: asString(value.summary) ?? asString(value.message) ?? asString(value.error) ?? 'Scheduled run',
  }
}

const normalizeHeartbeatException = (row: UiHeartbeatHistoryRow): UiHeartbeatException | undefined => {
  if (!['failed', 'error', 'stuck', 'skipped', '澶辫触', '鍗′綇'].includes(row.status)) {
    return undefined
  }

  return {
    id: row.id,
    jobId: row.jobId,
    runId: row.runId,
    name: row.jobId ?? row.runId ?? 'Scheduled task',
    type: row.status,
    time: row.time,
    status: row.status,
  }
}

export async function loadHeartbeatSnapshot(): Promise<HeartbeatSnapshot | undefined> {
  const [heartbeatStatus, heartbeatTasksResponse] = await Promise.all([
    jsonRequest<unknown>('/api/heartbeat/status'),
    jsonRequest<unknown>('/api/heartbeat/tasks'),
  ])

  const heartbeatTasksData = unwrapData(heartbeatTasksResponse)
  const heartbeatTasks = asArray(isRecord(heartbeatTasksData) ? heartbeatTasksData.tasks : heartbeatTasksData)
    .map(normalizeHeartbeatTask)
    .filter((task): task is UiHeartbeatTask => Boolean(task))

  if (heartbeatStatus || heartbeatTasks.length > 0) {
    const statusData = unwrapData(heartbeatStatus)
    const running = isRecord(statusData) && typeof statusData.running === 'boolean' ? statusData.running : undefined

    return { running, tasks: heartbeatTasks.length > 0 ? heartbeatTasks : undefined }
  }

  const [healthResponse, scheduledResponse] = await Promise.all([
    jsonRequest<unknown>('/api/mission-control/scheduled/health'),
    jsonRequest<unknown>('/api/mission-control/scheduled'),
  ])
  const healthData = unwrapData(healthResponse)
  const scheduledData = unwrapData(scheduledResponse)
  const scheduledRows = isRecord(scheduledData)
    ? [...asArray(scheduledData.jobs), ...asArray(scheduledData.legacy)]
    : asArray(scheduledData)
  const tasks = scheduledRows.map(normalizeHeartbeatTask).filter((task): task is UiHeartbeatTask => Boolean(task))
  const historyRows = (
    await Promise.all(
      tasks.slice(0, 8).map(async (task) => {
        if (!task.id) {
          return []
        }

        const runsResponse = await jsonRequest<unknown>(
          `/api/mission-control/scheduled/${encodeURIComponent(task.id)}/runs`,
        )
        const runsData = unwrapData(runsResponse)

        return asArray(isRecord(runsData) ? runsData.runs : runsData)
          .map(normalizeHeartbeatRun)
          .filter((run): run is UiHeartbeatHistoryRow => Boolean(run))
      }),
    )
  ).flat()

  if (tasks.length === 0 && !healthResponse) {
    return undefined
  }

  return {
    running: isRecord(healthData) && typeof healthData.running === 'boolean' ? healthData.running : undefined,
    tasks: tasks.length > 0 ? tasks : undefined,
    history: historyRows.length > 0 ? historyRows : undefined,
    exceptions: historyRows.map(normalizeHeartbeatException).filter((item): item is UiHeartbeatException => Boolean(item)),
  }
}

export async function setHeartbeatRunning(running: boolean): Promise<boolean> {
  const response = await jsonRequest<unknown>('/api/heartbeat/status', {
    method: 'POST',
    body: JSON.stringify({ running }),
  })

  return response !== undefined
}

export async function runScheduledTask(taskId?: string): Promise<boolean> {
  if (!taskId) {
    return false
  }

  const heartbeatResponse = await jsonRequest<unknown>(`/api/heartbeat/tasks/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
  })

  if (heartbeatResponse !== undefined) {
    return true
  }

  const scheduledResponse = await jsonRequest<unknown>(`/api/mission-control/scheduled/${encodeURIComponent(taskId)}/run`, {
    method: 'POST',
  })

  return scheduledResponse !== undefined
}

export async function pauseScheduledTask(taskId?: string, paused = true): Promise<boolean> {
  if (!taskId) {
    return false
  }

  const action = paused ? 'pause' : 'resume'
  const heartbeatResponse = await jsonRequest<unknown>(`/api/heartbeat/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: 'POST',
  })

  if (heartbeatResponse !== undefined) {
    return true
  }

  const scheduledResponse = await jsonRequest<unknown>(
    `/api/mission-control/scheduled/${encodeURIComponent(taskId)}/${action}`,
    { method: 'POST' },
  )

  return scheduledResponse !== undefined
}

export async function deleteScheduledTask(taskId?: string): Promise<boolean> {
  if (!taskId) {
    return false
  }

  const heartbeatResponse = await fetch(`/api/heartbeat/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }).catch(
    () => undefined,
  )

  if (heartbeatResponse?.ok) {
    return true
  }

  const scheduledResponse = await fetch(`/api/mission-control/scheduled/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  }).catch(() => undefined)

  return Boolean(scheduledResponse?.ok)
}

export async function createScheduledTask(input: HeartbeatTaskInput, runNow = false): Promise<UiHeartbeatTask | undefined> {
  const heartbeatResponse = await jsonRequest<unknown>('/api/heartbeat/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const heartbeatTask = normalizeHeartbeatTask(unwrapData(heartbeatResponse))

  if (heartbeatTask) {
    if (runNow) {
      await runScheduledTask(heartbeatTask.id)
    }

    return heartbeatTask
  }

  const scheduledResponse = await jsonRequest<unknown>('/api/mission-control/scheduled', {
    method: 'POST',
    body: JSON.stringify({
      title: input.name,
      schedule: { type: 'cron', expression: input.schedule },
      action: {
        type: input.actionType || 'system_event',
        summary: input.content,
        payload: { target: input.target, content: input.content },
      },
      retry: {
        maxAttempts: input.retryCount,
        intervalMs: input.retryIntervalMinutes * 60_000,
      },
    }),
  })
  const scheduledTask = normalizeHeartbeatTask(unwrapData(scheduledResponse))

  if (scheduledTask && runNow) {
    await runScheduledTask(scheduledTask.id)
  }

  return scheduledTask
}
