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
export interface ChatResult { text: string; completed: boolean; cancelled: boolean; error: string; completionTokens: number; promptTokens?: number; elapsedSeconds: number; thinking: string; tokensPerSecond: number }

export type BackendChoice = 'auto' | 'embedded' | 'ollama' | 'edge0'

export interface AppSettings { theme: 'system' | 'light' | 'dark'; material: 'solid' | 'mica' | 'acrylic'; accent: string; backend: BackendChoice; autoCheckUpdate: boolean; autoDownloadUpdate: boolean; autoInstallOnQuit: boolean; updateChannel: 'stable' | 'beta' }

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
  rolloutPercent?: number
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
}

/** 应用内升级前置结论：能不能装、装的是哪一版、还差什么条件。 */
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
