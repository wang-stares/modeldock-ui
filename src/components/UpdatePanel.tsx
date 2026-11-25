import { useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, FolderOpen, RefreshCw, X } from 'lucide-react'
import { api, installUpdate } from '../api'
import type { UpdateCheck, UpdateDownload } from '../types'

export function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '—'
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

/** 客户端下不动时的兜底：只打开公开仓库的 Release 页面，用户用自己的浏览器/下载器拿安装包。 */
function openReleasePage(url: string) {
  if (!url) return
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('open_url', { url }))
    .catch(() => { window.open(url, '_blank', 'noreferrer') })
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
  /** 安装前复核被拒时的原因。被拒后不再显示“重启并升级”，只留手动安装入口，避免红字和主按钮同时出现。 */
  const [blocked, setBlocked] = useState<string | null>(null)
  /** 被拒的原因是「绿色包装不了安装包」：这时增量（原地替换）还有机会，界面上给「重试增量升级」而不是只留手动安装。 */
  const [portableBlocked, setPortableBlocked] = useState(false)
  /** 安装这一步本身失败（UAC 被拒、安装器没起来、脚本报错）：给三条出路，而不是只弹一个 toast。 */
  const [installError, setInstallError] = useState('')

  // 重新下载或换了一个版本后，上一次的拒绝理由就过期了。
  useEffect(() => { setBlocked(null); setPortableBlocked(false); setInstallError('') }, [download?.version, download?.state])

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
   *  开启增量时先尝试只下补丁（约 5MB），失败或不可用自动回落到完整安装包。
   *  绿色包是例外：安装包对它永远装不了，整包被拒后再回头试一次增量。 */
  async function install(preferDelta: boolean) {
    setBusy(true)
    setBlocked(null)
    setPortableBlocked(false)
    try {
      // 已经下好整包（文件名是 .exe）就别再回头拉增量：走增量的那一步要联网，
      // 网络一卡，“确认重启”就会长时间毫无反应。整包既然已经过了 SHA256，直接拿它装。
      const alreadyFull = /\.exe$/i.test(download?.fileName ?? '')
      if (preferDelta && !alreadyFull) {
        const delta = await api.prepareUpdateDelta().catch(() => null)
        if (delta?.ok) {
          setInstalling(true)
          await api.applyUpdateDelta(delta.planPath, delta.version)
          return
        }
      }
      const prep = await api.updateInstallPrep()
      if (!prep.canInstall) {
        // 条件不满足时不再抛给全局提示：直接把主按钮换成“打开文件夹手动安装”，
        // 否则会出现“不能同版本覆盖”的红色提示和亮着的“重启并升级”并存的矛盾界面。
        if (prep.kind === 'portable') {
          // 绿色包：运行安装包会把它变成安装版，所以整包一定被拒；增量是原地替换，对它可用。
          // 以前这里直接拒绝，又因为下好的是 .exe 而从不回头试增量——绿色包永远升不了。
          const delta = await api.prepareUpdateDelta().catch(() => null)
          if (delta?.ok) {
            setInstalling(true)
            await api.applyUpdateDelta(delta.planPath, delta.version)
            return
          }
          setPortableBlocked(true)
          setBlocked(portableMessage(prep.error, delta?.error, download?.version ?? prep.version))
          return
        }
        setBlocked(prep.error || '当前无法应用内升级，请手动安装')
        return
      }
      setInstalling(true)
      await installUpdate(prep.installerPath, prep.expectedSha, prep.version)
    } catch (e) {
      setInstalling(false)
      const message = e instanceof Error ? e.message : '无法启动升级'
      // 失败要留在界面上：这三条出路（重试 / 打开文件夹 / 退出时自动装）比一个会消失的 toast 更有用。
      setInstallError(message)
      onMessage?.(message)
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
    // 瞬时速度会抖，用 0.6/0.4 的指数平滑；没有新字节就按 0 收敛，避免“停了还显示 20MB/s”。
    const inst = delta > 0 ? delta * 1000 / elapsed : 0
    setSpeed((last) => (inst === 0 ? (last > 0 ? last * 0.4 : 0) : last === 0 ? inst : last * 0.6 + inst * 0.4))
    sample.current = { bytes: download.receivedBytes, at: now }
  }, [download])

  const percent = download && download.totalBytes > 0
    ? Math.min(100, Math.round(download.receivedBytes * 100 / download.totalBytes))
    : 0

  // 剩余时间只在半分钟内显示：还有好几分钟时给秒数只会让人觉得更慢。
  const remainingBytes = download ? download.totalBytes - download.receivedBytes : 0
  const etaSeconds = speed > 0 && remainingBytes > 0 ? Math.max(1, Math.round(remainingBytes / speed)) : 0
  const etaLabel = etaSeconds > 0 && etaSeconds <= 30 ? ` · 剩余 ${etaSeconds} 秒` : ''

  return { download, busy, installing, blocked, portableBlocked, installError, start, pause, install, reveal, percent, speed, etaLabel }
}

/** 绿色包两条路都没走通时：说清两条路各自为什么不行，以及现在该怎么办。 */
function portableMessage(prepError: string, deltaError: string | undefined, version: string) {
  return (prepError || '当前是绿色包（免安装版），不能用安装包覆盖升级。')
    + (deltaError ? ` 增量升级也没能用上：${deltaError}` : ' 增量升级也没能用上。')
    + ` 请下载绿色包 Tianshu-${version}-win64.zip，退出应用后解压覆盖到程序所在目录；`
    + '或运行已下好的安装包，改用安装版（之后可以应用内升级）。'
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
        {busy
          ? '正在准备升级，通常几秒内会弹系统权限确认。超过半分钟没动静就是卡住了，可以改用「打开文件夹」手动安装。'
          : '升级会关闭当前窗口，并中断正在进行的模型下载（升级后可断点续传）。安装过程会弹一次系统权限确认。'}
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
export function UpdateBanner({ check, onDismiss, onOpenSettings, onMessage, onSnooze, onEnableQuitInstall, autoInstallOnQuit = true, forced = false }: {
  check: UpdateCheck
  onDismiss: () => void
  onOpenSettings: () => void
  onMessage?: (text: string) => void
  onSnooze?: (hours: number) => void
  onEnableQuitInstall?: () => void
  autoInstallOnQuit?: boolean
  forced?: boolean
}) {
  const { download, busy, installing, blocked, portableBlocked, installError, start, pause, install, reveal, percent, speed, etaLabel } = useUpdateDownload(onMessage)
  const [confirming, setConfirming] = useState(false)
  const ready = download?.state === 'ready'
  const deltaReady = ready && !!download && !!check.asset && download.totalBytes > 0 && download.totalBytes < check.asset.size
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'
  const paused = download?.state === 'paused'
  // 源与序号：换源时界面要跟着变，用户才知道“它在换一条路，不是卡死”。
  const sourceLabel = download?.sourceHost
    ? `${download.sourceHost}${download.sourceCount && download.sourceCount > 1 ? `（第 ${download.sourceIndex}/${download.sourceCount} 个源）` : ''}`
    : ''
  const connecting = download?.state === 'downloading' && download?.stage === 'connect'

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
            {blocked && ready
              ? `v${check.latestVersion} 需要手动安装`
              : ready ? `v${check.latestVersion} 已准备好`
              : check.downgrade ? `可换回正式版 v${check.latestVersion}`
              : `发现新版本 v${check.latestVersion}`}
            {check.latestVersion.includes('-') ? ' · 测试版' : ''}{forced ? ' · 必须升级' : ''}
          </div>
          <div className="update-banner-sub">
            当前 v{check.currentVersion}
            {download && download.totalBytes > 0 && check.asset && download.totalBytes < check.asset.size
              ? ` · 增量包 ${formatBytes(download.totalBytes)}`
              : check.asset ? ` · 安装包 ${formatBytes(check.asset.size)}` : ''}
            {ready ? (autoInstallOnQuit && !deltaReady ? ' · 重启或退出应用都会完成升级' : ' · 重启即可完成升级') : ''}
            {ready && download?.signed ? ' · 已签名' : ''}
            {forced && !ready ? ' · 当前版本太低，这版发布后不再提供旧版支持' : ''}
          </div>
        </div>
        {forced ? null : (
          <button type="button" className="update-banner-close" aria-label="忽略此版本" title="忽略此版本（不再提示这一版）" onClick={onDismiss}>
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
              : connecting
                ? `正在连接${sourceLabel ? ` ${sourceLabel}` : '下载地址'}…`
                : `正在下载 ${percent}%${speed > 0 ? ` · ${formatBytes(speed)}/s` : ''}${etaLabel}${sourceLabel ? ` · 源 ${sourceLabel}` : ''}`}
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

      {blocked && <div className="update-banner-error">{blocked}</div>}
      {ready && installError && !blocked && <div className="update-banner-error">{installError}</div>}

      {/* 被拒以后不再留“确认重启”：留着它，再点只会原样再被拒一次，看起来像点了没反应。 */}
      {confirming && !blocked && (
        <InstallConfirm busy={busy} onConfirm={() => void install(deltaReady)} onCancel={() => setConfirming(false)} />
      )}

      {!confirming && (
        <div className="update-banner-actions">
          {ready ? (
            blocked || installError ? (
              <>
                {installError && !blocked && (
                  <button type="button" className="btn primary sm" disabled={busy} onClick={() => setConfirming(true)}>
                    <Check aria-hidden />重试安装
                  </button>
                )}
                {portableBlocked && (
                  <button type="button" className="btn primary sm" disabled={busy} onClick={() => void install(true)}>
                    <RefreshCw aria-hidden />重试增量升级
                  </button>
                )}
                <button type="button" className={blocked || installError ? 'btn ghost sm' : 'btn primary sm'} onClick={() => void reveal()}>
                  <FolderOpen aria-hidden />打开文件夹手动装
                </button>
                {onEnableQuitInstall && !autoInstallOnQuit && download?.signed && (
                  <button type="button" className="btn ghost sm" onClick={onEnableQuitInstall}>
                    <RefreshCw aria-hidden />下次退出时自动装
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" className="btn primary sm" disabled={busy} onClick={() => setConfirming(true)}>
                  <Check aria-hidden />重启并升级
                </button>
                <button type="button" className="btn ghost sm" onClick={() => void reveal()}>
                  {deltaReady ? '下载文件' : '安装包'}
                </button>
                {onSnooze && <button type="button" className="btn ghost sm" onClick={() => onSnooze(24)}>24 小时后</button>}
              </>
            )
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
              {download?.state === 'failed' && check.releaseUrl && (
                <button type="button" className="btn ghost sm" onClick={() => openReleasePage(check.releaseUrl)}>
                  <ExternalLink aria-hidden />用浏览器下载
                </button>
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
