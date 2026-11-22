import { useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, RefreshCw, X } from 'lucide-react'
import { api, installUpdate } from '../api'
import type { UpdateCheck, UpdateDownload } from '../types'

export function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '—'
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

/** 公告正文来自 Release 的 Markdown；这里只做去符号的轻排版，不拼 HTML，避免注入。 */
export type NoteLine = { kind: 'sub' | 'item' | 'text'; text: string }

export function noteLines(notes: string): NoteLine[] {
  const lines: NoteLine[] = []
  for (const raw of notes.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('### ')) { lines.push({ kind: 'sub', text: line.slice(4) }); continue }
    if (line.startsWith('## ')) { lines.push({ kind: 'sub', text: line.slice(3) }); continue }
    if (line.startsWith('# ')) continue
    if (line.startsWith('- ')) {
      lines.push({ kind: 'item', text: line.slice(2).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '') })
      continue
    }
    lines.push({ kind: 'text', text: line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '') })
  }
  return lines
}

export function formatReleaseDate(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 安装包下载与安装的共享状态：横幅和设置页共用同一套轮询，避免两处同时下载。
 * 3.9.0 起「安装」不再是打开安装向导，而是交给桌面壳退出并覆盖安装。
 */
export function useUpdateDownload(onMessage?: (text: string) => void) {
  const [download, setDownload] = useState<UpdateDownload | null>(null)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let alive = true
    void api.updateDownload().then(state => {
      if (alive) setDownload(state)
    }).catch(() => { /* sidecar 还没起来时保持空状态 */ })
    return () => { alive = false }
  }, [])

  // 自动下载可能由启动流程在别处触发，所以只要面板还在就持续对齐状态，而不是等本地点了下载才开始轮询。
  useEffect(() => {
    if (installing) return
    const timer = window.setInterval(() => {
      void api.updateDownload().then(setDownload).catch(() => { /* 轮询失败就等下一次 */ })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [installing])

  async function start() {
    setBusy(true)
    try {
      setDownload(await api.startUpdateDownload())
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : '安装包下载失败')
    } finally { setBusy(false) }
  }

  async function pause() {
    try { setDownload(await api.pauseUpdateDownload()) } catch { /* 暂停失败保持原状态 */ }
  }

  /** 先问服务端能不能装，再交给桌面壳退出并安装；绿色版或校验缺失会被这里拦住。
   *  开启增量时先尝试只下补丁（约 5MB），失败或不可用自动回落到完整安装包。 */
  async function install(preferDelta = true) {
    setBusy(true)
    try {
      if (preferDelta) {
        const delta = await api.prepareUpdateDelta().catch(() => null)
        if (delta?.ok) {
          setInstalling(true)
          await api.applyUpdateDelta(delta.planPath, delta.version)
          return
        }
      }
      const prep = await api.updateInstallPrep()
      if (!prep.canInstall) throw new Error(prep.error || '当前无法应用内升级')
      setInstalling(true)
      await installUpdate(prep.installerPath, prep.expectedSha, prep.version)
    } catch (e) {
      setInstalling(false)
      onMessage?.(e instanceof Error ? e.message : '无法启动升级')
    } finally { setBusy(false) }
  }

  async function reveal() {
    try {
      await api.revealUpdate()
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : '无法打开下载目录')
    }
  }

  // 速度与剩余时间：按两次状态采样的差值估算，避免为它再加一个接口。
  const sample = useRef<{ bytes: number; at: number }>({ bytes: 0, at: 0 })
  const [speed, setSpeed] = useState(0)
  useEffect(() => {
    if (!download || download.state !== 'downloading') { setSpeed(0); sample.current = { bytes: 0, at: 0 }; return }
    const now = Date.now()
    const prev = sample.current
    if (prev.at === 0) { sample.current = { bytes: download.receivedBytes, at: now }; return }
    const elapsed = now - prev.at
    if (elapsed < 900) return
    const delta = download.receivedBytes - prev.bytes
    if (delta > 0) setSpeed(delta * 1000 / elapsed)
    sample.current = { bytes: download.receivedBytes, at: now }
  }, [download])

  const percent = download && download.totalBytes > 0
    ? Math.min(100, Math.round(download.receivedBytes * 100 / download.totalBytes))
    : 0

  return { download, busy, installing, start, pause, install, reveal, percent, speed }
}

/** 升级前的一次确认：窗口会被关掉，正在跑的模型下载会中断（升级后可续传）。 */
function InstallConfirm({ busy, onConfirm, onCancel }: {
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="update-confirm">
      <div className="update-confirm-text">
        升级会关闭当前窗口，并中断正在进行的模型下载（升级后可断点续传）。安装过程会弹一次系统权限确认。
      </div>
      <div className="update-confirm-actions">
        <button type="button" className="btn primary sm" disabled={busy} onClick={onConfirm}>
          <Check aria-hidden />确认重启
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>再等等</button>
      </div>
    </div>
  )
}

/** 启动时检测到新版本后的轻提示：进度、暂停/继续、重启升级都在横幅里完成，细节进设置页。 */
export function UpdateBanner({ check, onDismiss, onOpenSettings, onMessage, onSnooze, autoInstallOnQuit = true, forced = false }: {
  check: UpdateCheck
  onDismiss: () => void
  onOpenSettings: () => void
  onMessage?: (text: string) => void
  onSnooze?: (hours: number) => void
  autoInstallOnQuit?: boolean
  forced?: boolean
}) {
  const { download, busy, installing, start, pause, install, reveal, percent, speed } = useUpdateDownload(onMessage)
  const [confirming, setConfirming] = useState(false)
  const ready = download?.state === 'ready'
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'
  const paused = download?.state === 'paused'

  if (installing) {
    return (
      <div className="update-banner" role="status">
        <div className="update-banner-head">
          <span className="update-banner-badge"><RefreshCw size={14} aria-hidden /></span>
          <div className="update-banner-copy">
            <div className="update-banner-title">正在安装 v{check.latestVersion}</div>
            <div className="update-banner-sub">系统弹出权限确认时请选“是”；确认后应用会自动关闭，装完再自动打开</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-head">
        <span className="update-banner-badge"><RefreshCw size={14} aria-hidden /></span>
        <div className="update-banner-copy">
          <div className="update-banner-title">
            {ready ? `v${check.latestVersion} 已准备好` : `发现新版本 v${check.latestVersion}`}
            {forced ? ' · 必须升级' : ''}
          </div>
          <div className="update-banner-sub">
            当前 v{check.currentVersion}
            {check.asset ? ` · 安装包 ${formatBytes(check.asset.size)}` : ''}
            {ready ? (autoInstallOnQuit ? ' · 重启或退出应用都会完成升级' : ' · 重启即可完成升级') : ''}
            {ready && download?.signed ? ' · 已签名' : ''}
            {forced && !ready ? ' · 当前版本太低，这版发布后不再提供旧版支持' : ''}
          </div>
        </div>
        {forced ? null : (
          <button type="button" className="update-banner-close" aria-label="稍后再说" onClick={onDismiss}>
            <X size={15} aria-hidden />
          </button>
        )}
      </div>

      {downloading && (
        <div className="update-progress" aria-label={`已下载 ${percent}%`}>
          <div className="update-progress-bar"><span style={{ width: `${percent}%` }} /></div>
          <div className="update-progress-note">
            {download?.state === 'verifying'
              ? '正在校验签名与 SHA256…'
              : `正在下载 ${percent}%${speed > 0 ? ` · ${formatBytes(speed)}/s` : ''}${speed > 0 && download && download.totalBytes > download.receivedBytes ? ` · 剩余 ${Math.max(1, Math.round((download.totalBytes - download.receivedBytes) / speed))} 秒` : ''}`}
          </div>
        </div>
      )}

      {paused && (
        <div className="update-progress-note">
          下载已暂停，已保存 {formatBytes(download?.receivedBytes ?? 0)}，继续时从断点接着下。
        </div>
      )}

      {download?.state === 'failed' && download.error && (
        <div className="update-banner-error">{download.error}</div>
      )}

      {confirming && (
        <InstallConfirm busy={busy} onConfirm={() => void install()} onCancel={() => setConfirming(false)} />
      )}

      {!confirming && (
        <div className="update-banner-actions">
          {ready ? (
            <>
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => setConfirming(true)}>
                <Check aria-hidden />重启并升级
              </button>
              <button type="button" className="btn ghost sm" onClick={() => void reveal()}>安装包</button>
              {onSnooze && <button type="button" className="btn ghost sm" onClick={() => onSnooze(24)}>24 小时后</button>}
            </>
          ) : paused ? (
            <button type="button" className="btn primary sm" disabled={busy} onClick={() => void start()}>
              <Download aria-hidden />继续下载
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn primary sm"
                disabled={busy || downloading || !check.asset}
                onClick={() => void start()}
              >
                <Download aria-hidden />
                {downloading ? '下载中…' : download?.state === 'failed' ? '重新下载' : '开始下载'}
              </button>
              {downloading && (
                <button type="button" className="btn ghost sm" onClick={() => void pause()}>暂停</button>
              )}
            </>
          )}
          <button type="button" className="btn ghost sm" onClick={onOpenSettings}>
            <ExternalLink aria-hidden />详情
          </button>
        </div>
      )}
    </div>
  )
}
