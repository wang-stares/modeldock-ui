import type { AgentMemoryClearResult, AgentMemoryInfo, AppSettings, AutostartState, DiagnosticCleanupResult, DiagnosticLogStatus, DiagnosticTail, FontLibraryState, GoalResult, GoalSnapshot, Edge0Settings, Edge0State, Edge0Status, CatalogModel, ChatModels, DownloadJob, GpuRuntimeActionResult, GpuRuntimeState, HardwareProfile, ModelDirectorySaveResult, ModelDirectoryState, ModelDeleteResult, ModelSourceUpdate, ModelSourcesState, Recommendation, RuntimeOpResult, RuntimeState, StorageCleanupResult, StorageOverview, SessionBinding, SubTasksState, WorkspaceDiff, WebFetchResult, WorkspaceEntry, WorkspaceFile, WorkspaceInfo, WorkspaceChangeRow, StoredSession, StreamChunk, UpdateCheck, UpdateDownload, UpdateInstallPrep, UpdateInstallResult, UpdateOutcome, DeltaPrepareResult } from './types'

export interface ApiConfig { baseUrl: string; token: string }

let config: ApiConfig = {
  baseUrl: (import.meta as any).env?.VITE_API_BASE ?? 'http://127.0.0.1:47821',
  token: (import.meta as any).env?.VITE_API_TOKEN ?? 'dev-token',
}

/** 后台内核上报的版本；与界面硬编码的 APP_VERSION 对不上说明安装不完整。 */
let runtimeVersion = ''

export function getRuntimeVersion(): string {
  return runtimeVersion
}

export async function initApi(): Promise<ApiConfig> {
  if (typeof window === 'undefined' || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    // Browser preview / unit smoke: keep the dev config.
    return config
  }
  let core: typeof import('@tauri-apps/api/core')
  try {
    core = await import('@tauri-apps/api/core')
  } catch {
    throw new Error('无法加载 Tauri 桥接层')
  }
  const live = await core.invoke<ApiConfig>('api_config')
  if (live?.baseUrl) config = live
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const res = await fetch(config.baseUrl + '/api/health')
      if (res.ok) {
        try {
          const body = await res.json() as { version?: string }
          if (typeof body?.version === 'string') runtimeVersion = body.version
        } catch { /* 健康检查响应异常时保持空，界面回退到 APP_VERSION */ }
        return config
      }
    } catch { /* sidecar still booting */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('本机内核启动超时，请重新连接')
}

export function apiConfig() { return config }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-Tianshu-Token', config.token)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(config.baseUrl + path, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string') detail = parsed
      else if (parsed && typeof parsed.error === 'string') detail = parsed.error
      else if (parsed && typeof parsed.message === 'string') detail = parsed.message
    } catch { /* 非 JSON 错误体就原样展示 */ }
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('/api/health'),
  hardware: () => request<HardwareProfile>('/api/hardware'),
  recommend: () => request<Recommendation[]>('/api/library/recommend'),
  refine: () => request<Recommendation[]>('/api/library/refine', { method: 'POST' }),
  search: (query: string, page = 1, pageSize = 24) =>
    request<{ models: CatalogModel[]; warning: string }>(`/api/library/search?query=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`),
  variants: (key: string) => request<CatalogModel>('/api/library/variants', { method: 'POST', body: JSON.stringify({ key }) }),
  downloads: () => request<DownloadJob[]>('/api/downloads'),
  startDownload: (key: string, fileName: string) =>
    request<DownloadJob>('/api/downloads', { method: 'POST', body: JSON.stringify({ key, fileName }) }),
  cancelDownload: (id: string) => request<DownloadJob>(`/api/downloads/${id}/cancel`, { method: 'POST' }),
  // agent 传了就只回那个形态的会话（4.0.0 阶段 0：左上角切形态 = 切 agent，列表跟着换作用域）
  sessions: (agent?: string) =>
    request<{ sessions: StoredSession[]; lastSessionId: string | null }>('/api/chat/sessions' + (agent ? `?agent=${encodeURIComponent(agent)}` : '')),
  /** 只回会话 id / 标题 / 绑定模型，不带 turns；「我的模型」页数绑定用，避免拉全量历史。 */
  sessionBindings: () =>
    request<{ sessions: SessionBinding[]; lastSessionId: string | null; revision: number }>('/api/chat/sessions/bindings'),
  createSession: (title = '新会话', agent?: string) =>
    request<StoredSession>('/api/chat/sessions', { method: 'POST', body: JSON.stringify({ title, agent }) }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),
  chatModels: () => request<ChatModels>('/api/chat/models'),
  /** 模型运行态：后端、是否可达、此刻驻留的清单、正在启动或关闭的那一份。 */
  runtime: () => request<RuntimeState>('/api/runtime'),
  /** 可选 GPU 扩展包：安装包内置或用户目录里的那份。 */
  gpuRuntime: () => request<GpuRuntimeState>('/api/runtime/gpu'),
  installGpuRuntime: () => request<GpuRuntimeActionResult>('/api/runtime/gpu/install', { method: 'POST' }),
  removeGpuRuntime: () => request<GpuRuntimeActionResult>('/api/runtime/gpu/remove', { method: 'POST' }),
  cancelGpuRuntime: () => request<GpuRuntimeState>('/api/runtime/gpu/cancel', { method: 'POST' }),
  dismissGpuPrompt: () => request<{ ok: boolean; status: GpuRuntimeState }>('/api/runtime/gpu/prompt-dismiss', { method: 'POST' }),
  /**
   * 启动一份并常驻。allowMultiple 是「明知会同时驻两份也照做」的显式选项：
   * 不勾时后端会直接拒，不拿用户的显存去试。
   */
  loadModel: (model: string, allowMultiple = false) =>
    request<RuntimeOpResult>('/api/runtime/load', { method: 'POST', body: JSON.stringify({ model, allowMultiple }) }),
  unloadModel: (model: string) =>
    request<RuntimeOpResult>('/api/runtime/unload', { method: 'POST', body: JSON.stringify({ model }) }),
  modelDirectory: () => request<ModelDirectoryState>('/api/models/directory'),
  saveModelDirectory: (path: string) =>
    request<ModelDirectorySaveResult>('/api/models/directory', { method: 'PUT', body: JSON.stringify({ path }) }),
  deleteModel: (fileName: string) =>
    request<ModelDeleteResult>(`/api/models/${encodeURIComponent(fileName)}`, { method: 'DELETE' }),
  fonts: () => request<FontLibraryState>('/api/fonts'),
  downloadFont: (id: string) => request<FontLibraryState>('/api/fonts/download', { method: 'POST', body: JSON.stringify({ id }) }),
  deleteFont: (id: string) => request<FontLibraryState>(`/api/fonts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** 字体文件带 token 取成 Blob；前端用 FontFace 注册，避免把 token 拼进 CSS。 */
  fontBlob: async (id: string): Promise<Blob> => {
    const res = await fetch(`${config.baseUrl}/api/fonts/${encodeURIComponent(id)}/file`, {
      headers: { 'X-Tianshu-Token': config.token },
    })
    if (!res.ok) throw new Error(await res.text().catch(() => '字体文件读不到'))
    return res.blob()
  },
  uploadFont: async (file: File): Promise<FontLibraryState> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(config.baseUrl + '/api/fonts/upload', {
      method: 'POST',
      headers: { 'X-Tianshu-Token': config.token },
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed.error === 'string') detail = parsed.error
      } catch { /* 非 JSON 错误体 */ }
      throw new Error(detail || `${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<FontLibraryState>
  },
  settings: () => request<AppSettings>('/api/settings'),
  saveSettings: (settings: AppSettings) => request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  resetSettings: () => request<AppSettings>('/api/settings/reset', { method: 'POST' }),
  storage: () => request<StorageOverview>('/api/storage'),
  revealStorage: (kind: 'data' | 'logs' | 'models' | 'updates') =>
    request<{ ok: boolean }>('/api/storage/reveal', { method: 'POST', body: JSON.stringify({ kind }) }),
  cleanupLogs: () => request<StorageCleanupResult>('/api/storage/cleanup-logs', { method: 'POST' }),
  diagnostics: () => request<DiagnosticLogStatus>('/api/diagnostics'),
  diagnosticsTail: (lines = 200) => request<DiagnosticTail>(`/api/diagnostics/tail?lines=${lines}`),
  cleanupDiagnostics: () => request<DiagnosticCleanupResult>('/api/diagnostics/cleanup', { method: 'POST' }),
  autostart: () => request<AutostartState>('/api/autostart'),
  setAutostart: (enabled: boolean, startMinimized = false) => request<AutostartState>('/api/autostart', { method: 'PUT', body: JSON.stringify({ enabled, startMinimized }) }),
  edge0: () => request<Edge0State>('/api/edge0'),
  saveEdge0: (settings: Edge0Settings) => request<Edge0State>('/api/edge0', { method: 'PUT', body: JSON.stringify(settings) }),
  probeEdge0: () => request<Edge0Status>('/api/edge0/probe', { method: 'POST' }),
  sources: () => request<ModelSourcesState>('/api/sources'),
  saveSource: (id: string, update: ModelSourceUpdate) =>
    request<ModelSourcesState>(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(update) }),
  // 工作区面板：只读文件面与改动列表，路径边界与 agent 的写工具同一套
  workspaceInfo: () => request<WorkspaceInfo>('/api/workspace/info'),
  workspaceTree: (path: string) =>
    request<{ entries: WorkspaceEntry[]; error?: string }>(`/api/workspace/tree?path=${encodeURIComponent(path)}`),
  workspaceFile: (path: string) =>
    request<{ file: WorkspaceFile | null; error?: string }>(`/api/workspace/file?path=${encodeURIComponent(path)}`),
  /** 某个文件的行级 diff（拿它最近的检查点当改动前）。没备份时 hasBase=false。 */
  /** 浏览器页签：抓一个公开网页读正文。协议、体积、超时、跳转都在服务端限死 */
  webFetch: (url: string) => request<WebFetchResult>('/api/web/fetch', { method: 'POST', body: JSON.stringify({ url }) }),
  workspaceDiff: (path: string) => request<WorkspaceDiff>(`/api/workspace/diff?path=${encodeURIComponent(path)}`),
  workspaceChanges: () =>
    request<{ changes: WorkspaceChangeRow[]; reversible: number; irreversible: number; note: string }>('/api/workspace/changes'),
  checkUpdate: (force = false) => request<UpdateCheck>(`/api/update/check${force ? '?force=true' : ''}`),
  allowUpdateStepBack: (version: string) =>
    request<{ ok: boolean }>('/api/update/step-back', { method: 'POST', body: JSON.stringify({ version }) }),
  updateDownload: () => request<UpdateDownload>('/api/update/download'),
  updateDiagnostics: () => request<{ channel: string; logPath: string; text: string }>('/api/update/diagnostics'),
  startUpdateDownload: () => request<UpdateDownload>('/api/update/download', { method: 'POST' }),
  updateResult: () => request<UpdateOutcome | null>('/api/update/result'),
  prepareUpdateDelta: () => request<DeltaPrepareResult>('/api/update/delta/prepare', { method: 'POST' }),
  applyUpdateDelta: (planPath: string, version: string) =>
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('apply_delta_update', { planPath, version })),
  revealUpdate: () => request<{ ok: boolean }>('/api/update/reveal', { method: 'POST' }),
  cleanupUpdate: () => request<{ removed: number; freedBytes: number; failed: string[] }>('/api/update/cleanup', { method: 'POST' }),
  updateInstallPrep: () => request<UpdateInstallPrep>('/api/update/install-prep'),
  pauseUpdateDownload: () => request<UpdateDownload>('/api/update/download/pause', { method: 'POST' }),
}

function isTauriRuntime() {
  return typeof window !== 'undefined' &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/** 退出并安装必须由桌面壳执行：先停本地内核，再拉起安装器，最后退出自身。 */
export async function installUpdate(path: string, expectedSha: string, version: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('当前不在天枢客户端内，无法执行应用内升级。')
  const core = await import('@tauri-apps/api/core')
  await core.invoke('install_update', { path, expectedSha, version })
}

/** 启动时读一次安装锁：返回非空表示上次升级没装完，版本已经对不上。 */
export async function takeInstallResult(): Promise<UpdateInstallResult | null> {
  if (!isTauriRuntime()) return null
  const core = await import('@tauri-apps/api/core')
  return core.invoke<UpdateInstallResult | null>('take_install_result')
}

export async function streamChat(
  body: { sessionId: string; model: string; content: string },
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Tianshu-Token': config.token })
  const res = await fetch(config.baseUrl + '/api/chat/stream', { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) throw new Error(await res.text().catch(() => '对话服务不可用'))
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      onChunk(JSON.parse(payload) as StreamChunk)
    }
  }
}

export interface AgentStreamBody { sessionId: string; model: string; content: string; profile?: string; planOnly?: boolean; followPlan?: boolean }

/** 任务代理的流：事件按顺序到达，界面只按 type 分派，不猜状态。 */
export async function streamAgent(
  body: AgentStreamBody,
  onEvent: (event: import('./types').AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json', 'X-Tianshu-Token': config.token })
  const res = await fetch(config.baseUrl + '/api/agent/stream', { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) throw new Error(await res.text().catch(() => '任务代理不可用'))
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      try {
        onEvent(JSON.parse(payload) as import('./types').AgentEvent)
      } catch { /* 单帧解析失败不影响后续帧 */ }
    }
  }
}

export interface AgentProfileInfo {
  name: string
  displayName: string
  summary: string
  maxRounds: number
  maxToolCalls: number
  maxMinutes: number
}

export interface AgentToolsInfo {
  workspace: string
  profile: string
  displayName: string
  profiles: AgentProfileInfo[]
  tools: { name: string; kind: string; description: string }[]
}

export const agentApi = {
  tools: (profile?: string) =>
    request<AgentToolsInfo>('/api/agent/tools' + (profile ? `?profile=${encodeURIComponent(profile)}` : '')),
  decide: (runId: string, callId: string, allow: boolean, scope: 'once' | 'session') =>
    request<{ ok: boolean }>('/api/agent/decision', { method: 'POST', body: JSON.stringify({ runId, callId, allow, scope }) }),
  cancel: (runId: string) => request<{ ok: boolean }>(`/api/agent/runs/${runId}/cancel`, { method: 'POST' }),
  memory: () => request<AgentMemoryInfo>('/api/agent/memory'),
  /** 此刻在跑的子任务（换页、刷新后仍能恢复任务卡）。 */
  subtasks: () => request<SubTasksState>('/api/agent/subtasks'),
  /** 停掉一个子任务：只停这一个，不动整次执行。 */
  cancelSubtask: (id: string) =>
    request<{ ok: boolean; error: string; note: string }>(`/api/agent/subtasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  /** 当前目标（没有就是 null）。 */
  goal: (sessionId: string) => request<{ goal: GoalSnapshot | null }>(`/api/agent/goal?sessionId=${encodeURIComponent(sessionId)}`),
  /** 声明 / 暂停 / 继续 / 完成 / 清掉目标。 */
  setGoal: (body: {
    sessionId: string
    action: 'declare' | 'pause' | 'resume' | 'complete' | 'clear'
    objective?: string
    acceptance?: string[]
    turnBudget?: number
    tokenBudget?: number
    wallClockMinutes?: number
    evidence?: string[]
    relaxBudget?: boolean
    profile?: string
  }) => request<GoalResult>('/api/agent/goal', { method: 'POST', body: JSON.stringify(body) }),
  forgetSession: (key: string) => request<{ ok: boolean }>(`/api/agent/memory/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  forgetNote: (scope: 'workspace' | 'global', text: string) =>
    request<{ ok: boolean }>(`/api/agent/memory/notes?scope=${scope}&text=${encodeURIComponent(text)}`, { method: 'DELETE' }),
  clearMemory: () => request<AgentMemoryClearResult>('/api/agent/memory', { method: 'DELETE' }),
}
