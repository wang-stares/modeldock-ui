export type PageKey = 'library' | 'chat' | 'downloads' | 'settings'

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
export interface StoredSession { id: string; title: string; createdAt: string; updatedAt: string; turns: StoredTurn[] }

export interface ChatModels { backend: string; backendDetail: string; models: string[]; embeddedReady: boolean }

export interface StreamChunk { type: 'delta' | 'done' | 'error'; text?: string; result?: ChatResult }
export interface ChatResult { text: string; completed: boolean; cancelled: boolean; error: string; completionTokens: number; promptTokens?: number; elapsedSeconds: number; thinking: string; tokensPerSecond: number; contextBudget?: number; contextWindow?: number }

export type BackendChoice = 'auto' | 'embedded' | 'ollama' | 'edge0'

export interface AppSettings { theme: 'system' | 'light' | 'dark'; material: 'solid' | 'mica' | 'acrylic'; accent: string; backend: BackendChoice; autoCheckUpdate: boolean; autoDownloadUpdate: boolean; autoInstallOnQuit: boolean; updateChannel: 'stable' | 'beta'; deltaUpdate: boolean }

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
  | { type: 'run'; runId: string; sessionId: string; workspace: string; model: string; window?: AgentWindowInfo }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; runId: string; id: string; name: string; target: string; status: AgentToolStatus; detail?: string; ms?: number; round?: number }
  | { type: 'todo'; items: AgentTodoItem[]; warning?: string }
  | { type: 'confirm'; runId: string; callId: string; tool: string; target: string; title: string; detail: string; kind: string }
  | { type: 'done'; runId: string; text: string; stop: string; rounds: number; toolCalls: number; error: string; todo: AgentTodoItem[]; window?: AgentWindowInfo }
  | { type: 'error'; text: string }
