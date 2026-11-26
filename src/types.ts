export type PageKey = 'library' | 'models' | 'chat' | 'downloads' | 'settings'

/** 代理形态：办公与编程。切形态等于切一个 agent（工具集、预算与工作法都不同），差异在 `AgentProfile` 一处表达。 */
export type AgentProfileId = 'office' | 'code'

export interface HardwareProfile {
  ramBytes: number
  cores: number
  freeDiskBytes: number
  gpuName: string
  gpuMemoryBytes: number | null
  cpuName: string
  availableRamBytes: number
  installedRamBytes: number
  physicalCores: number
  cpuMaxGhz: number
  avx2: boolean
  ramGb: number
  availableRamGb: number
  installedRamGb: number
  coreText: string
  cpuText: string
  ramText: string
  freeDiskGb: number
  gpuMemoryGb: number
  hasGpu: boolean
  budgetGb: number
  summary: string
}

export interface RepoRef { source: number; repoId: string }
export interface VariantSource { source: number; repoId: string; fileName: string; sizeBytes: number; sha256: string }
export interface ModelVariant {
  fileName: string
  quantization: string
  sizeBytes: number
  sha256: string
  sources: VariantSource[]
  hasChecksum: boolean
  gguf?: unknown
}
export interface CatalogModel {
  key: string
  displayName: string
  baseName: string
  publisher: string
  license: string
  parameters: number | null
  downloads: number
  repos: RepoRef[]
  variants: ModelVariant[]
  commercialUse: boolean
  parameterLabel: string
  sources: number[]
  hasChecksum: boolean
}
export interface ModelFit {
  level: number
  requiredGb: number
  budgetGb: number
  reason: string
  label: string
  usable: boolean
}
export interface Recommendation { model: CatalogModel; variant: ModelVariant; fit: ModelFit }
export interface LibraryResult { models: CatalogModel[]; warning: string; hasWarning: boolean }

export interface DownloadJob {
  id: string
  modelName: string
  fileName: string
  targetPath: string
  state: number
  percent: number
  bytes: number
  totalBytes: number | null
  message: string
  verification: string
  usedSource: number | null
  isRunning: boolean
}

export interface StoredTurn { role: number; content: string; thinking: string }
export interface StoredSession { id: string; title: string; createdAt: string; updatedAt: string; turns: StoredTurn[]; model: string }

/** 此刻真的占着内存的一份模型；不是「装了哪些」。 */
export interface RunningModel { name: string; contextLength: number; sizeVramBytes: number | null; resident: boolean; expiresAt: string | null }

/** 模型运行态：后端、可达性、驻留清单、正在启动或关闭的那一份。 */
export interface RuntimeState {
  backend: string
  kind: 'none' | 'ollama' | 'edge0' | 'embedded'
  detail: string
  connected: boolean
  busy: string
  canControl: boolean
  running: RunningModel[]
}

/** 一次启动 / 关闭的结果；message 是能直接给用户看的一句话。 */
export interface RuntimeOpResult { ok: boolean; model: string; message: string; contextLength: number }

export interface ChatModels { backend: string; backendDetail: string; models: string[]; embeddedReady: boolean; loaded: string[]; busy: string }

export interface StreamChunk { type: 'delta' | 'done' | 'error'; text?: string; result?: ChatResult }
export interface ChatResult { text: string; completed: boolean; cancelled: boolean; error: string; completionTokens: number; promptTokens?: number; elapsedSeconds: number; thinking: string; tokensPerSecond: number; contextBudget?: number; contextWindow?: number }

export type BackendChoice = 'auto' | 'embedded' | 'ollama' | 'edge0'

export interface AppSettings { theme: 'system' | 'light' | 'dark'; material: 'solid' | 'mica' | 'acrylic'; accent: string; backend: BackendChoice; autoCheckUpdate: boolean; autoDownloadUpdate: boolean; autoInstallOnQuit: boolean; updateChannel: 'stable' | 'beta'; deltaUpdate: boolean; agentNetwork: boolean }

export interface UpdateAssetInfo { name: string; size: number; url: string }

export interface UpdateCheck {
  available: boolean
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseUrl: string
  publishedAt: string
  notes: string
  asset: UpdateAssetInfo | null
  checksumsUrl: string | null
  checkedAt: string
  error: string
  channel?: 'stable' | 'beta'
  forced?: boolean
  rolloutPending?: boolean
  rolloutPercent?: number
  /** 用户同意换回的正式版比当前测试版低：这是一次往回装，不是升级。 */
  downgrade?: boolean
}

export type UpdateDownloadState = 'idle' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'failed'

export interface UpdateDownload {
  state: UpdateDownloadState
  fileName: string
  receivedBytes: number
  totalBytes: number
  path: string
  verified: boolean
  expectedSha: string
  actualSha: string
  error: string
  version: string
  signed?: boolean
  checksumError?: string
  /** connect 正在连源 / transfer 正在收字节 / verify 正在校验，空表示没在下载。 */
  stage?: 'connect' | 'transfer' | 'verify' | ''
  sourceHost?: string
  sourceIndex?: number
  sourceCount?: number
}

/** 应用内升级前置结论：能不能装、装的是哪一版、还差什么条件。 */
/** 增量准备结论：补丁与还原是否就绪、计划文件与下载体积。 */
export interface DeltaPrepareResult {
  ok: boolean
  version: string
  files: number
  bytes: number
  downloadedBytes: number
  planPath: string
  error: string
}

/** 上次升级的结论：版本号、是否成功、时间与原因。 */
export interface UpdateOutcome {
  version: string
  ok: boolean
  at: string
  reason: string
}

export interface UpdateInstallPrep {
  canInstall: boolean
  kind: 'installer' | 'portable' | 'dev'
  installerPath: string
  expectedSha: string
  version: string
  requiresElevation: boolean
  blockingReasons: string[]
  error: string
}

export interface UpdateInstallResult {
  version: string
  startedAt: number
}

export interface Edge0Settings { endpoint: string; modelAlias: string; modelDirectory: string }
export interface Edge0Status { available: boolean; endpoint: string; detail: string }
export interface Edge0State { settings: Edge0Settings; status: Edge0Status }

export type ModelSourceId = 'modelscope' | 'modelscope-intl' | 'huggingface' | 'opencsg'

export interface ModelSourceState {
  id: ModelSourceId
  name: string
  enabled: boolean
  ready: boolean
  requiresToken: boolean
  tokenConfigured: boolean
  detail: string
}

export interface ModelSourcesState {
  sources: ModelSourceState[]
  enabledCount: number
  readyCount: number
}

export interface ModelSourceUpdate { enabled: boolean; token?: string; clearToken?: boolean }

/** 一份长时程目标的快照（4.0.0 阶段 3）。三维预算各自给上限 / 已用 / 是否触顶。 */
export interface GoalDimension { limit: number | null; used: number; over: boolean }
export interface GoalSnapshot {
  objective: string
  acceptance: string[]
  state: 'active' | 'paused' | 'blocked' | 'complete'
  stateLabel: string
  version: number
  armed: boolean
  blockedCode: string
  blockedReason: string
  noProgressRounds: number
  verifiable: boolean
  turns: GoalDimension
  tokens: GoalDimension
  wallClock: GoalDimension
  minutesUsed: number
  updatedAt: string
}
export interface GoalResult { ok: boolean; error: string; goal: GoalSnapshot | null }

/** 一个正在跑的子任务：界面用它画卡片并给出「单独停止」。 */
export interface RunningSubTaskRow {
  id: string
  agent: string
  label: string
  objective: string
  maxTurns: number
  maxRuntimeSeconds: number
  startedAt: string
  secondsRunning: number
}
export interface SubTasksState { running: RunningSubTaskRow[]; capacity: number; inflightLimit: number }

export interface ExtractedLink { index: number; text: string; href: string; external: boolean }
/** 浏览器页签 v1：抓回来抽成正文与链接，界面转义渲染（不渲染 HTML、不执行脚本） */
export interface WebFetchResult {
  error: string
  url: string
  title: string
  text: string
  links: ExtractedLink[]
  rawChars: number
  truncated: boolean
  note: string
}

export interface DiffLineView { kind: '+' | '-' | ' '; text: string; old: number; new: number }
export interface DiffHunkView { header: string; oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLineView[] }
/** 行级 diff 的响应。hasBase=false 表示没有改动前的备份，比不出来。 */
export interface WorkspaceDiff {
  error: string
  hasBase: boolean
  note?: string
  added?: number
  removed?: number
  truncated?: boolean
  fallback?: string
  eolOnly?: boolean
  hunks?: DiffHunkView[]
}

/** 工作区面板：文件节点、文件预览、改动记录（4.0.0 阶段 5）。全部只读。 */
export interface WorkspaceEntry { name: string; relativePath: string; isDirectory: boolean; size: number; children: number; kindLabel: string }
export interface WorkspaceFile {
  relativePath: string
  /** 枚举在线上是数字，界面一律读 kindKey */
  kind: number
  kindKey: 'text' | 'markdown' | 'code' | 'image' | 'document' | 'needs-shell' | 'binary' | 'missing' | 'too-large'
  text: string
  encoding: string
  size: number
  totalLines: number
  truncated: boolean
  note: string
  dataUrl?: string
}
export interface WorkspaceInfo { root: string; exists: boolean; bytes: number; files: number; folders: number; sizeLabel: string }
export interface WorkspaceChangeRow { relativePath: string; action: string; actionLabel: string; reversible: boolean; checkpointId: string; bytes: number; at: string; tool: string; sessionId: string }

export type AgentToolStatus = 'confirm' | 'run' | 'ok' | 'fail' | 'denied'

export interface AgentToolItem {
  id: string
  name: string
  target: string
  status: AgentToolStatus
  detail?: string
  ms?: number
  round?: number
}

/** 一份会话记忆：只装程序按执行结果记下的进度，按「会话编号 + 工作目录」隔离。 */
export interface AgentMemorySessionInfo {
  key: string
  task: string
  updatedAt: string
  changed: string[]
  commands: string[]
  deadEnds: string[]
}

export interface AgentMemoryInfo {
  workspace: string
  notes: { workspace: string[]; global: string[] }
  sessions: AgentMemorySessionInfo[]
}

/**
 * 这次执行的窗口安排：要了多大的窗口、后端实际给了多少（报不出来为 null）、对话与单次回复各留多少。
 * enough 为 false 时 note 里有一句给人看的原因。
 */
export interface AgentWindowInfo {
  planned: number
  actual: number | null
  modelMax: number | null
  budget: number
  maxReply: number
  enough: boolean
  note: string
}

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTodoItem { index: number; content: string; status: AgentTodoStatus }

export interface AgentConfirm {
  runId: string
  callId: string
  tool: string
  target: string
  title: string
  detail: string
  kind: string
}

export type AgentEvent =
  | { type: 'run'; runId: string; sessionId: string; workspace: string; model: string; profile?: string; displayName?: string; planOnly?: boolean; planPath?: string; followPlan?: boolean; boundModel?: string; bindKind?: string; goal?: GoalSnapshot | null; goalSuspended?: boolean; window?: AgentWindowInfo }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; runId: string; id: string; name: string; target: string; status: AgentToolStatus; detail?: string; ms?: number; round?: number }
  | { type: 'todo'; items: AgentTodoItem[]; warning?: string }
  | { type: 'confirm'; runId: string; callId: string; tool: string; target: string; title: string; detail: string; kind: string }
  | { type: 'done'; runId: string; text: string; stop: string; rounds: number; toolCalls: number; error: string; todo: AgentTodoItem[]; planPath?: string; goal?: GoalSnapshot | null; goalSaveError?: string; window?: AgentWindowInfo }
  | { type: 'goal'; state: string; text: string; reason: string; ok: boolean }
  | { type: 'subtask'; runId: string; callId: string; taskId: string; label: string; phase: 'started' | 'ended'; status: string; detail?: string; ok?: boolean; ms?: number }
  | { type: 'error'; text: string; code?: string }
