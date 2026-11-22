import type { AppSettings, Edge0Settings, Edge0State, Edge0Status, CatalogModel, ChatModels, DownloadJob, HardwareProfile, ModelSourceUpdate, ModelSourcesState, Recommendation, StoredSession, StreamChunk } from './types'

export interface ApiConfig { baseUrl: string; token: string }

let config: ApiConfig = {
  baseUrl: (import.meta as any).env?.VITE_API_BASE ?? 'http://127.0.0.1:47821',
  token: (import.meta as any).env?.VITE_API_TOKEN ?? 'dev-token',
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
      if (res.ok) return config
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
  search: (query: string, page = 1, pageSize = 24) =>
    request<{ models: CatalogModel[]; warning: string }>(`/api/library/search?query=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`),
  variants: (key: string) => request<CatalogModel>('/api/library/variants', { method: 'POST', body: JSON.stringify({ key }) }),
  downloads: () => request<DownloadJob[]>('/api/downloads'),
  startDownload: (key: string, fileName: string) =>
    request<DownloadJob>('/api/downloads', { method: 'POST', body: JSON.stringify({ key, fileName }) }),
  cancelDownload: (id: string) => request<DownloadJob>(`/api/downloads/${id}/cancel`, { method: 'POST' }),
  sessions: () => request<{ sessions: StoredSession[]; lastSessionId: string | null }>('/api/chat/sessions'),
  createSession: (title = '新会话') => request<StoredSession>('/api/chat/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`/api/chat/sessions/${id}`, { method: 'DELETE' }),
  chatModels: () => request<ChatModels>('/api/chat/models'),
  settings: () => request<AppSettings>('/api/settings'),
  saveSettings: (settings: AppSettings) => request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  edge0: () => request<Edge0State>('/api/edge0'),
  saveEdge0: (settings: Edge0Settings) => request<Edge0State>('/api/edge0', { method: 'PUT', body: JSON.stringify(settings) }),
  probeEdge0: () => request<Edge0Status>('/api/edge0/probe', { method: 'POST' }),
  sources: () => request<ModelSourcesState>('/api/sources'),
  saveSource: (id: string, update: ModelSourceUpdate) =>
    request<ModelSourcesState>(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(update) }),
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
