import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initApi, api, takeInstallResult } from './api'
import { TitleBar } from './components/TitleBar'
import { Rail } from './components/Rail'
import { SplashScreen } from './components/SplashScreen'
import type { LaunchPhase } from './components/SplashScreen'
import { Onboarding } from './components/Onboarding'
import { UpdateBanner } from './components/UpdatePanel'
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding'
import { LibraryPage } from './pages/LibraryPage'
import { ChatPage } from './pages/ChatPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { SettingsPage } from './pages/SettingsPage'
import type { AppSettings, DownloadJob, HardwareProfile, PageKey, UpdateCheck } from './types'

const defaultSettings: AppSettings = { theme: 'system', material: 'acrylic', accent: '#3482ff', backend: 'auto', autoCheckUpdate: true, autoDownloadUpdate: true, autoInstallOnQuit: true, updateChannel: 'stable' }

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('stardock.ui')
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } as AppSettings : defaultSettings
  } catch { return defaultSettings }
}

function effectiveTheme(theme: AppSettings['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  const [page, setPage] = useState<PageKey>(() => {
    const value = new URLSearchParams(window.location.search).get('page')
    return value === 'chat' || value === 'downloads' || value === 'settings' ? value : 'library'
  })
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
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
  const toastTimer = useRef<number | null>(null)

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
      toast(`上次升级到 v${result.version} 没有完成，可在「设置 → 版本更新」重试`)
    }).catch(() => { /* 浏览器预览或读锁失败时静默 */ })
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
    if (next) setPage(next)
    else if (completed) setPage('library')
  }, [])

  const dismissUpdate = useCallback((check: UpdateCheck) => {
    try { localStorage.setItem('stardock.update.skipped', check.latestVersion) } catch { /* 隐私模式忽略 */ }
    setUpdateCheck(null)
  }, [])

  const openUpdateSettings = useCallback(() => {
    setUpdateCheck(null)
    setPage('settings')
  }, [])

  const running = useMemo(() => jobs.filter(job => job.state === 0).length, [jobs])

  const pageBody = page === 'chat'
    ? <ChatPage toast={toast} onOpenLibrary={() => setPage('library')} />
    : (
      <div className="page-scroll">
        {page === 'library' && <LibraryPage hardware={hardware} onHardware={() => { /* popover handled inside page */ }} jobs={jobs} toast={toast} />}
        {page === 'downloads' && <DownloadsPage jobs={jobs} refresh={() => void refreshDownloads()} toast={toast} onOpenLibrary={() => setPage('library')} />}
        {page === 'settings' && <SettingsPage settings={settings} onChange={patch => setSettings(prev => ({ ...prev, ...patch }))} hardware={hardware} onReplayTour={replayTour} />}
      </div>
    )

  return (
    <div className="app">
      <div className="ambient" aria-hidden><i /><i /><i /></div>
      <TitleBar page={page} />
      {ready && (
        <div className="workspace">
          <Rail page={page} onNavigate={setPage} runningDownloads={running} backend={backend} onTour={replayTour} />
          <main className="main">
            <div className="page-stage" key={page}>{pageBody}</div>
          </main>
        </div>
      )}
      {!splashDone && (
        <SplashScreen
          phase={launchPhase}
          error={bootError}
          onRetry={retryBoot}
          onDone={finishSplash}
        />
      )}
      {ready && splashDone && updateCheck && (
        <UpdateBanner
          check={updateCheck}
          onDismiss={() => dismissUpdate(updateCheck)}
          onOpenSettings={openUpdateSettings}
          onMessage={toast}
          autoInstallOnQuit={settings.autoInstallOnQuit}
          forced={updateCheck.forced === true}
        />
      )}
      {ready && splashDone && tourOpen && (
        <Onboarding jobs={jobs} onNavigate={setPage} onClose={closeTour} />
      )}
      {toastText && <div className="toast">{toastText}</div>}
    </div>
  )
}
