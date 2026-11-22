import { useEffect, useState } from 'react'
import { Check, Download, ExternalLink, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
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

/** 安装包下载的共享状态：横幅和设置页共用同一套轮询，避免两处同时下载。 */
export function useUpdateDownload(onMessage?: (text: string) => void) {
  const [download, setDownload] = useState<UpdateDownload | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void api.updateDownload().then(state => {
      if (alive) setDownload(state)
    }).catch(() => { /* sidecar 还没起来时保持空状态 */ })
    return () => { alive = false }
  }, [])

  const active = download?.state === 'downloading' || download?.state === 'verifying'

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      void api.updateDownload().then(setDownload).catch(() => { /* 轮询失败就等下一次 */ })
    }, 700)
    return () => window.clearInterval(timer)
  }, [active])

  async function start() {
    setBusy(true)
    try {
      setDownload(await api.startUpdateDownload())
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : '安装包下载失败')
    } finally { setBusy(false) }
  }

  async function cancel() {
    try { setDownload(await api.cancelUpdateDownload()) } catch { /* 取消失败保持原状态 */ }
  }

  async function launch() {
    try {
      await api.launchUpdate()
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : '无法打开安装包')
    }
  }

  async function reveal() {
    try {
      await api.revealUpdate()
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : '无法打开下载目录')
    }
  }

  const percent = download && download.totalBytes > 0
    ? Math.min(100, Math.round(download.receivedBytes * 100 / download.totalBytes))
    : 0

  return { download, busy, start, cancel, launch, reveal, percent }
}

/** 启动时检测到新版本后的轻提示：只给版本号、体积和一个一键下载按钮，其余细节进设置页。 */
export function UpdateBanner({ check, onDismiss, onOpenSettings, onMessage }: {
  check: UpdateCheck
  onDismiss: () => void
  onOpenSettings: () => void
  onMessage?: (text: string) => void
}) {
  const { download, busy, start, launch, percent } = useUpdateDownload(onMessage)
  const ready = download?.state === 'ready'
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-head">
        <span className="update-banner-badge"><RefreshCw size={14} aria-hidden /></span>
        <div className="update-banner-copy">
          <div className="update-banner-title">发现新版本 v{check.latestVersion}</div>
          <div className="update-banner-sub">
            当前 v{check.currentVersion}
            {check.asset ? ` · 安装包 ${formatBytes(check.asset.size)}` : ''}
          </div>
        </div>
        <button type="button" className="update-banner-close" aria-label="稍后再说" onClick={onDismiss}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {downloading && (
        <div className="update-progress" aria-label={`已下载 ${percent}%`}>
          <div className="update-progress-bar"><span style={{ width: `${percent}%` }} /></div>
          <div className="update-progress-note">
            {download?.state === 'verifying' ? '正在校验 SHA256…' : `正在下载 ${percent}%`}
          </div>
        </div>
      )}

      {download?.state === 'failed' && download.error && (
        <div className="update-banner-error">{download.error}</div>
      )}

      <div className="update-banner-actions">
        {ready ? (
          <button type="button" className="btn primary sm" onClick={() => void launch()}>
            <Check aria-hidden />打开安装包
          </button>
        ) : (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || downloading || !check.asset}
            onClick={() => void start()}
          >
            <Download aria-hidden />
            {downloading ? '下载中…' : '一键下载'}
          </button>
        )}
        <button type="button" className="btn ghost sm" onClick={onOpenSettings}>
          <ExternalLink aria-hidden />详情
        </button>
      </div>
    </div>
  )
}
