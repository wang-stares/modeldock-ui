import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { initApi, api, takeInstallResult } from './api'
import { TitleBar } from './components/TitleBar'
import { Rail } from './components/Rail'
import { commitAsOneShot, markMotionMode, setOneShotDirection } from './components/viewTransition'
import { SplashScreen } from './components/SplashScreen'
import type { LaunchPhase } from './components/SplashScreen'
import { Onboarding } from './components/Onboarding'
import { UpdateBanner } from './components/UpdatePanel'
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding'
import { LibraryPage } from './pages/LibraryPage'
import { ModelsPage } from './pages/ModelsPage'
import { ChatPage } from './pages/ChatPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { SettingsPage } from './pages/SettingsPage'
import type { AgentProfileId, AppSettings, DownloadJob, HardwareProfile, PageKey, UpdateCheck } from './types'

const defaultSettings: AppSettings = { theme: 'system', material: 'acrylic', accent: '#3482ff', backend: 'auto', autoCheckUpdate: true, autoDownloadUpdate: true, autoInstallOnQuit: true, updateChannel: 'stable', deltaUpdate: true, agentNetwork: false, closeToTray: true, downloadConcurrency: 1, downloadLimitKbps: 0, notifyDownloadComplete: true, inferenceContext: 0, inferenceGpuLayers: -1, inferenceThreads: 0, startupSplash: 'full', startupPage: 'library', chatSendKey: 'enter', chatFontSize: 'standard', chatFont: 'system', chatWrapLong: true, defaultAgentMode: 'last', diagnosticLogEnabled: false, diagnosticLogMode: 'days', diagnosticLogDays: 7, diagnosticLogSizeMb: 100 }

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('stardock.ui')
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } as AppSettings : defaultSettings
  } catch { return defaultSettings }
}

const pageKeys: PageKey[] = ['library', 'models', 'chat', 'downloads', 'settings']

/** 环境光随页面平移：换页时背景层缓慢挪位，制造“镜头在同一空间里移动”的错觉。 */
const ambientDrift: Record<PageKey, { x: number; y: number }> = {
  library: { x: 0, y: 0 },
  models: { x: 28, y: -16 },
  chat: { x: -24, y: 20 },
  downloads: { x: 34, y: 14 },
  settings: { x: -30, y: -20 },
}
function isPageKey(value: string | null): value is PageKey {
  return value !== null && pageKeys.includes(value as PageKey)
}

function resolveStartupPage(preference: AppSettings['startupPage']): PageKey {
  if (preference === 'chat') return 'chat'
  if (preference === 'last') {
    try {
      const last = localStorage.getItem('stardock.lastPage')
      if (isPageKey(last)) return last
    } catch { /* 隐私模式忽略 */ }
  }
  return 'library'
}

function effectiveTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  // 左侧工作台折叠：只有展开/折叠两档，**不做拖拽调宽**（用户明确要求）。
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('stardock.railCollapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('stardock.railCollapsed', railCollapsed ? '1' : '0') } catch { /* 存不进去就算了 */ }
  }, [railCollapsed])

  const [page, setPage] = useState<PageKey>(() => {
    const value = new URLSearchParams(window.location.search).get('page')
    if (isPageKey(value)) return value
    return resolveStartupPage(loadSettings().startupPage)
  })
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  // 当前 agent 形态放在 App：左上角切它，会话页与对话都跟着换（3.x 把它藏在会话页的输入框旁）。
  const [agent, setAgentState] = useState<AgentProfileId>(() => {
    if (settings.defaultAgentMode === 'office' || settings.defaultAgentMode === 'code') {
      return settings.defaultAgentMode
    }
    try { return localStorage.getItem('stardock.agent') === 'office' ? 'office' : 'code' } catch { return 'code' }
  })
  const [hardware, setHardware] = useState<HardwareProfile | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [backend, setBackend] = useState('本地推理')
  const [toastText, setToastText] = useState('')
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const [bootAttempt, setBootAttempt] = useState(0)
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>('connect')
  const [splashDone, setSplashDone] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null)
  const [settingsJump, setSettingsJump] = useState<{ section: 'update' | 'updates'; id: number } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const previousJobs = useRef<DownloadJob[]>([])
  const startupPageApplied = useRef(false)
  const agentDefaultApplied = useRef(false)
  const agentUserSelected = useRef(false)

  useEffect(() => {
    if (!ready || startupPageApplied.current) return
    startupPageApplied.current = true
    const queryPage = new URLSearchParams(window.location.search).get('page')
    if (isPageKey(queryPage)) return
    setPage(resolveStartupPage(settings.startupPage))
  }, [ready, settings.startupPage])

  // 固定形态只在启动时结算一次；设置页里改「默认 Agent」留给下一次启动。
  useEffect(() => {
    if (!ready || agentDefaultApplied.current) return
    agentDefaultApplied.current = true
    if (agentUserSelected.current) return
    if (settings.defaultAgentMode === 'office' || settings.defaultAgentMode === 'code') {
      setAgentState(settings.defaultAgentMode)
    }
  }, [ready, settings.defaultAgentMode])

  markMotionMode()

  // 只有用户主动换页才记「上次页面」；启动落点、后端回填与 ?page= 调试都不覆盖它。
  function goPage(next: PageKey) {
    if (next === page) return
    const from = pageKeys.indexOf(page)
    const to = pageKeys.indexOf(next)
    setOneShotDirection(to > from ? 'down' : 'up')
    commitAsOneShot(() => setPage(next))
    try { localStorage.setItem('stardock.lastPage', next) } catch { /* 隐私模式忽略 */ }
  }

  function setAgent(next: AgentProfileId) {
    if (next === agent) return
    agentUserSelected.current = true
    setAgentState(next)
    try { localStorage.setItem('stardock.agent', next) } catch { /* 隐私模式忽略 */ }
    toast(next === 'office' ? '已切到办公 agent：只读写工作区，不执行命令' : '已切到编程 agent：可按白名单执行命令，每次都要你点头')
  }

  function toast(message: string) {
    setToastText(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastText(''), 3200)
  }

  async function refreshDownloads() {
    try {
      const list = await api.downloads()
      setJobs(list)
      const running = list.some(job => job.state === 0)
      if (running) setBackend('本地推理')
    } catch { /* sidecar may still be booting */ }
  }

  useEffect(() => {
    let alive = true
    setReady(false)
    setBootError('')
    setLaunchPhase('connect')
    async function boot() {
      try {
        await initApi()
        if (!alive) return
        setLaunchPhase('probe')
        const [hw, list, saved] = await Promise.all([
          api.hardware(),
          api.downloads(),
          api.settings().catch(() => null),
        ])
        if (!alive) return
        if (saved) setSettings(prev => ({ ...prev, ...saved }))
        setHardware(hw)
        setJobs(list)
        setLaunchPhase('ready')
        setReady(true)
      } catch (e) {
        if (!alive) return
        setBootError(e instanceof Error ? e.message : '本机内核没有响应')
        setLaunchPhase('error')
      }
    }
    void boot()
    return () => { alive = false }
  }, [bootAttempt])

  useEffect(() => {
    const interval = window.setInterval(() => { void refreshDownloads() }, 2200)
    return () => window.clearInterval(interval)
  }, [])

  // Ctrl+, 打开设置（Esc 返回由设置页自己处理）；不拦截输入框里的普通按键。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        goPage('settings')
        // 页面刚挂载时搜索框还不存在，等一拍再聚焦；已经在设置页时由设置页自己处理。
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.settings-search')?.focus(), 80)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 下载从「进行中」变成「已完成」时提示一次；初始化时已有的历史不算新完成。
  useEffect(() => {
    const finished = jobs.filter(job =>
      job.state === 1 && previousJobs.current.some(previous => previous.id === job.id && previous.state === 0))
    previousJobs.current = jobs
    if (finished.length === 0 || !settings.notifyDownloadComplete) return
    const name = finished[0].modelName || finished[0].fileName
    toast(finished.length === 1 ? `${name} 下载完成` : `${finished.length} 个模型下载完成`)
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow, UserAttentionType }) =>
        getCurrentWindow().requestUserAttention(UserAttentionType.Informational))
      .catch(() => { /* 浏览器预览或窗口不在前台时忽略 */ })
  }, [jobs, settings.notifyDownloadComplete])

  useEffect(() => {
    const root = document.documentElement
    const apply = () => { root.dataset.theme = effectiveTheme(settings.theme) }
    apply()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => { if (settings.theme === 'system') apply() }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings.theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent)
    const hover = `color-mix(in srgb, ${settings.accent} 84%, #0b2a55)`
    document.documentElement.style.setProperty('--accent-hover', hover)
    document.documentElement.style.setProperty('--accent-soft', `${hover}1c`)
    document.documentElement.style.setProperty('--accent-softer', `${hover}0d`)
    document.documentElement.dataset.material = settings.material
    const theme = document.documentElement.dataset.theme || 'light'
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_material', { material: settings.material, theme }))
      .catch(() => { /* browser preview */ })
    try { localStorage.setItem('stardock.ui', JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  // 对话阅读区字体：界面保持系统字体，只有 chat-layout 用 --chat-font。
  // 目录字体和上传字体都先取成本地 Blob，再用 FontFace 注册，避免 token 进入 CSS。
  useEffect(() => {
    const root = document.documentElement
    const fallback = '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    const misans = '"MiSans VF", "MiSans", "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif'
    let cancelled = false
    let face: FontFace | null = null
    let objectUrl: string | null = null
    const target = settings.chatFont === 'catalog:' || settings.chatFont === 'custom:'
      ? ''
      : settings.chatFont.startsWith('catalog:') ? settings.chatFont.slice('catalog:'.length)
      : settings.chatFont.startsWith('custom:') ? settings.chatFont.slice('custom:'.length)
      : ''
    root.style.setProperty('--chat-font', settings.chatFont === 'misans' ? misans : fallback)

    if (ready && target) {
      void (async () => {
        try {
          const blob = await api.fontBlob(target)
          if (cancelled) return
          objectUrl = URL.createObjectURL(blob)
          face = new FontFace('TianshuSelectedFont', `url("${objectUrl}")`)
          await face.load()
          if (cancelled) return
          document.fonts.add(face)
          root.style.setProperty('--chat-font', `"TianshuSelectedFont", ${misans}`)
        } catch {
          if (!cancelled) root.style.setProperty('--chat-font', fallback)
        }
      })()
    }

    return () => {
      cancelled = true
      if (face) document.fonts.delete(face)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ready, settings.chatFont])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => {
      void api.saveSettings(settings).catch(() => { /* offline is fine */ })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [settings, ready])

  // 启动检查：等首屏稳定后再请求公开仓库，失败静默，不打断进入应用的流程。
  useEffect(() => {
    if (!ready || !settings.autoCheckUpdate) return
    let alive = true
    const timer = window.setTimeout(() => {
      void api.checkUpdate().then(check => {
        if (!alive || !check.available || !check.latestVersion) return
        let skipped = ''
        try { skipped = localStorage.getItem('stardock.update.skipped') ?? '' } catch { /* 隐私模式忽略 */ }
        if (skipped === check.latestVersion && !check.forced) return
        // 主动延后提醒：到点之前不再弹同一条横幅。
        try {
          const snooze = JSON.parse(localStorage.getItem('stardock.update.snooze') ?? '{}')
          if (!check.forced && snooze.version === check.latestVersion && Number(snooze.until) > Date.now()) return
        } catch { /* 隐私模式忽略 */ }
        setUpdateCheck(check)
      }).catch(() => { /* 离线或接口限流时不提示 */ })
    }, 1600)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [ready, settings.autoCheckUpdate])

  // 上次升级是否落地：版本对上静默清锁，对不上就提示“没装完”，避免用户以为已经升过。
  useEffect(() => {
    if (!ready) return
    let alive = true
    void takeInstallResult().then(result => {
      if (!alive || !result) return
      toast(`上次升级到 v${result.version} 没有完成，可在「设置 → 更新与公告」重试`)
    }).catch(() => { /* 浏览器预览或读锁失败时静默 */ })
    return () => { alive = false }
  }, [ready])

  // 升上去了也要说一声：同一份结果只在第一次启动时提示，避免每次开窗都弹。
  useEffect(() => {
    if (!ready) return
    let alive = true
    void api.updateResult().then(result => {
      if (!alive || !result?.ok) return
      let seen = ''
      try { seen = localStorage.getItem('stardock.update.toasted') ?? '' } catch { /* 隐私模式忽略 */ }
      if (seen === result.at) return
      try { localStorage.setItem('stardock.update.toasted', result.at) } catch { /* 忽略 */ }
      toast(`已升级到 v${result.version}`)
    }).catch(() => { /* 读不到结果就不提示 */ })
    return () => { alive = false }
  }, [ready])

  // 默认在应用运行时就把安装包下好：发现新版本 → 后台下载 → 校验完成后再提示“重启即可”。
  useEffect(() => {
    if (!ready || !updateCheck?.available) return
    if (!settings.autoCheckUpdate || !settings.autoDownloadUpdate) return
    const version = updateCheck.latestVersion ?? ''
    let failed: { version?: string; at?: number } = {}
    try { failed = JSON.parse(localStorage.getItem('stardock.update.failed') ?? '{}') } catch { /* 隐私模式忽略 */ }
    // 同一版本失败过就退避 24 小时：避免每次开窗都重试几十兆下载；手动点下载不受影响。
    if (!updateCheck.forced && failed.version === version && typeof failed.at === 'number' && Date.now() - failed.at < 24 * 3600_000) return
    const markFailed = () => {
      try { localStorage.setItem('stardock.update.failed', JSON.stringify({ version, at: Date.now() })) } catch { /* 忽略 */ }
    }
    let alive = true
    void api.updateDownload().then(state => {
      if (!alive) return
      if (state.state !== 'idle' && state.state !== 'failed') return
      if (state.state === 'failed') markFailed()
      return api.startUpdateDownload().then(() => { /* 进度由横幅轮询 */ })
    }).catch(() => { markFailed() })
    return () => { alive = false }
  }, [ready, updateCheck, settings.autoCheckUpdate, settings.autoDownloadUpdate])

  useEffect(() => {
    if (!ready || !splashDone || hasSeenOnboarding()) return
    const timer = window.setTimeout(() => setTourOpen(true), 360)
    return () => window.clearTimeout(timer)
  }, [ready, splashDone])

  const finishSplash = useCallback(() => setSplashDone(true), [])
  const retryBoot = useCallback(() => setBootAttempt(value => value + 1), [])
  const replayTour = useCallback(() => setTourOpen(true), [])
  const closeTour = useCallback((completed: boolean, next?: PageKey) => {
    setTourOpen(false)
    markOnboardingSeen()
    if (next) goPage(next)
    else if (completed) goPage('library')
  }, [])

  const snoozeUpdate = useCallback((check: UpdateCheck, hours: number) => {
    try {
      localStorage.setItem('stardock.update.snooze', JSON.stringify({ version: check.latestVersion, until: Date.now() + hours * 3600_000 }))
    } catch { /* 隐私模式忽略 */ }
    setUpdateCheck(null)
  }, [])

  const dismissUpdate = useCallback((check: UpdateCheck) => {
    try { localStorage.setItem('stardock.update.skipped', check.latestVersion) } catch { /* 隐私模式忽略 */ }
    setUpdateCheck(null)
  }, [])

  const openUpdateSettings = useCallback(() => {
    setUpdateCheck(null)
    setSettingsJump({ section: 'update', id: Date.now() })
    goPage('settings')
  }, [])

  const openReleaseNotes = useCallback(() => {
    setUpdateCheck(null)
    setSettingsJump({ section: 'updates', id: Date.now() })
    goPage('settings')
  }, [])

  // 安装器拉不起来时的第三条路：不用现在装，退出应用时自动装（走壳层的退出即安装）。
  const enableQuitInstall = useCallback(() => {
    void api.saveSettings({ ...settings, autoInstallOnQuit: true })
      .then(next => {
        setSettings(next)
        toast('已开启：下次退出应用时会自动安装新版本')
      })
      .catch(() => toast('开启失败，可以在「设置 → 更新与公告」里手动打开'))
  }, [settings])

  const running = useMemo(() => jobs.filter(job => job.state === 0).length, [jobs])

  const pageBody = page === 'chat'
    ? <ChatPage
        toast={toast}
        agent={agent}
        sendKey={settings.chatSendKey}
        chatFontSize={settings.chatFontSize}
        chatWrapLong={settings.chatWrapLong}
        onOpenLibrary={() => goPage('library')}
        onOpenModels={() => goPage('models')}
      />
    : (
      <div className="page-scroll">
        {page === 'library' && <LibraryPage hardware={hardware} onHardware={() => { /* popover handled inside page */ }} jobs={jobs} toast={toast} />}
        {page === 'models' && <ModelsPage toast={toast} onOpenChat={() => goPage('chat')} onOpenLibrary={() => goPage('library')} />}
        {page === 'downloads' && <DownloadsPage jobs={jobs} refresh={() => void refreshDownloads()} toast={toast} onOpenLibrary={() => goPage('library')} />}
        {page === 'settings' && <SettingsPage settings={settings} onChange={patch => setSettings(prev => ({ ...prev, ...patch }))} onReset={next => setSettings(next)} hardware={hardware} onReplayTour={replayTour} jumpTo={settingsJump} onJumpHandled={() => setSettingsJump(null)} />}
      </div>
    )

  return (
    <div className="app">
      <div
        className="ambient"
        aria-hidden
        style={{ '--drift-x': `${ambientDrift[page].x}px`, '--drift-y': `${ambientDrift[page].y}px` } as CSSProperties}
      >
        <i /><i /><i />
      </div>
      <TitleBar page={page} agent={agent} onAgent={setAgent} />
      {ready && (
        <div className={`workspace ${railCollapsed ? 'rail-collapsed' : ''}`}>
          <Rail page={page} onNavigate={goPage} runningDownloads={running} backend={backend} onTour={replayTour}
            collapsed={railCollapsed} onToggle={() => setRailCollapsed(v => !v)} />
          <main className="main">
            <div className="page-stage" key={page}>{pageBody}</div>
          </main>
        </div>
      )}
      {!splashDone && (
        <SplashScreen
          phase={launchPhase}
          error={bootError}
          quick={settings.startupSplash === 'quick'}
          onRetry={retryBoot}
          onDone={finishSplash}
        />
      )}
      {ready && splashDone && updateCheck && (
        <UpdateBanner
          check={updateCheck}
          onDismiss={() => dismissUpdate(updateCheck)}
          onOpenSettings={openUpdateSettings}
          onOpenReleaseNotes={openReleaseNotes}
          onMessage={toast}
          onSnooze={(hours) => snoozeUpdate(updateCheck, hours)}
          onEnableQuitInstall={enableQuitInstall}
          autoInstallOnQuit={settings.autoInstallOnQuit}
          forced={updateCheck.forced === true}
        />
      )}
      {ready && splashDone && tourOpen && (
        <Onboarding jobs={jobs} onNavigate={goPage} onClose={closeTour} />
      )}
      {toastText && <div className="toast">{toastText}</div>}
    </div>
  )
}
