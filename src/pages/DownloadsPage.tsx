import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowRight, CheckCircle2, CircleStop, Clock3, DownloadCloud, FolderOpen, HardDrive } from 'lucide-react'
import { api } from '../api'
import type { DownloadJob, ModelDirectoryState } from '../types'

function bytes(value: number | null | undefined) {
  if (!value) return '—'
  const gb = value / 1024 / 1024 / 1024
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(value / 1024 / 1024)} MB`
}
function rate(bytesPerSecond: number | null | undefined) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '测速中…'
  const mb = bytesPerSecond / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}
function eta(seconds: number | null | undefined) {
  if (seconds == null || seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
function stateLabel(job: DownloadJob) {
  if (job.state === 0) return '下载中'
  if (job.state === 1) return '已完成'
  if (job.state === 3) return '已取消'
  return '失败'
}
function stateChip(job: DownloadJob) {
  if (job.state === 0) return 'accent'
  if (job.state === 1) return 'success'
  if (job.state === 3) return 'warn'
  return 'danger'
}

export function DownloadsPage({ jobs, refresh, toast, onOpenLibrary }: { jobs: DownloadJob[]; refresh: () => void; toast: (message: string) => void; onOpenLibrary?: () => void }) {
  const [directory, setDirectory] = useState<ModelDirectoryState | null>(null)
  useEffect(() => { void api.modelDirectory().then(setDirectory).catch(() => {}) }, [])
  const running = jobs.filter(j => j.state === 0)
  const done = jobs.filter(j => j.state === 1)
  const failed = jobs.filter(j => j.state === 2 || j.state === 3)
  const used = jobs.reduce((sum, j) => sum + (j.state === 1 ? j.bytes : 0), 0)

  async function cancel(job: DownloadJob) {
    try {
      await api.cancelDownload(job.id)
      toast('已取消，已下载分片将保留在 .part 文件中')
      refresh()
    } catch (e) { toast(e instanceof Error ? e.message : '取消失败') }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">Downloads</div>
          <h1 className="page-title">下载中心</h1>
          <p className="page-sub">断点续传 · 失败自动换源 · 写入磁盘前校验 SHA256、文件体积与 GGUF 结构；源站未提供 SHA256 时不标记为完成。</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={refresh}><DownloadCloud />刷新</button>
        </div>
      </div>

      <div className="downloads-layout">
      <div className="download-list">
        {jobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><DownloadCloud /></div>
            <h3>暂无下载任务</h3>
            <p>前往「模型库」选择模型。推荐页会按本机内存与显存筛选可运行档位，点击即可开始下载。</p>
            {onOpenLibrary && <button className="btn primary empty-cta" data-tour="downloads-empty-cta" onClick={onOpenLibrary}><ArrowRight />前往模型库</button>}
          </div>
        ) : jobs.map((job, index) => {
          const pct = Math.max(0, Math.min(1, job.percent || 0))
          return (
            <article className="download-row" key={job.id} data-tour={index === 0 ? 'downloads-first' : undefined}>
              <div className="download-cover">{job.modelName.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="download-name">{job.modelName}</div>
                <div className="download-sub">
                  {job.fileName}
                  {job.state !== 0 ? ` · ${job.message}` : ''}
                </div>
              </div>
              <div className="progress-wrap">
                <div className="progress-head">
                  <span>{job.state === 0 ? `${Math.round(pct * 100)}%` : stateLabel(job)}</span>
                  <span>{job.state === 0 ? rate(job.bytesPerSecond) : bytes(job.totalBytes || job.bytes)}</span>
                </div>
                <div className={`progress ${job.state === 1 ? 'completed' : job.state === 2 || job.state === 3 ? 'failed' : ''}`}>
                  <i style={{ width: `${job.state === 1 ? 100 : pct * 100}%` }} />
                </div>
                {job.state === 0 && (
                  <div className="progress-detail">
                    <span>已接收 {bytes(job.bytes)} / {bytes(job.totalBytes || job.bytes)}</span>
                    <span>{eta(job.etaSeconds) ? `剩余 ${eta(job.etaSeconds)}` : '剩余时间计算中'}</span>
                  </div>
                )}
              </div>
              <div className="download-action">
                {job.state === 0 ? <button className="btn ghost sm" onClick={() => void cancel(job)}><CircleStop />取消</button> :
                  <span className={`chip ${stateChip(job)}`}>{job.state === 1 ? <CheckCircle2 /> : <Clock3 />}{stateLabel(job)}</span>}
              </div>
            </article>
          )
        })}
        {jobs.length === 0 && (
          <div className="download-guide">
            <div><span>01</span><h4>选择适配模型</h4><p>推荐页按本机内存与显存筛选，并标明体积、量化档位与许可证。</p></div>
            <div><span>02</span><h4>后台断点续传</h4><p>切换页面或最小化窗口不会中断；失败自动换源，已下载分片保留在 .part 文件中。</p></div>
            <div><span>03</span><h4>写入前校验</h4><p>SHA256、文件体积与 GGUF 结构全部通过后才写入模型目录；源站未提供哈希值时拒绝完成，损坏或截断文件不会进入模型目录。</p></div>
          </div>
        )}
      </div>

      <div className="side-stack">
        <div className="side-card">
          <div className="side-title">队列概览</div>
          <div className="metric-row">
            <div className="metric"><div className="metric-label">进行中</div><div className="metric-value">{running.length}</div></div>
            <div className="metric"><div className="metric-label">已完成</div><div className="metric-value">{done.length}</div></div>
            <div className="metric"><div className="metric-label">失败 / 取消</div><div className="metric-value">{failed.length}</div></div>
            <div className="metric"><div className="metric-label">已占用</div><div className="metric-value" style={{ fontSize: 14 }}>{bytes(used)}</div></div>
          </div>
        </div>
        <div className="side-card">
          <div className="side-title">本地模型</div>
          {directory && <div className="note" title={directory.current}>落盘目录：<code>{directory.custom ? directory.current : "默认目录"}</code></div>}
          {done.length === 0 ? <div className="note">暂无已完成模型。下载完成后将在此处显示。</div> : done.slice(0, 8).map(job => (
            <div className="mini-model" key={job.id}><i className="mini-dot" /><span className="mini-name">{job.modelName}</span><span className="mini-size">{bytes(job.bytes)}</span></div>
          ))}
        </div>
        <div className="side-card">
          <div className="side-title">下载安全</div>
          <div className="note">仅接受 HTTPS；源站 SHA256、文件体积与 GGUF 结构全部通过后才写入模型目录。模型权重不做杀毒扫描；哈希一致仅表示文件与源站声明一致，不代表源站本身可信。</div>
        </div>
        <div className="side-card">
          <div className="side-title">换源顺序</div>
          <div className="note">魔搭 → 魔搭国际 →（设置中启用时）OpenCSG → hf-mirror → Hugging Face 官方。某个来源报错或校验失败时自动切换下一个；分片带有来源标识，换源不会将不同来源的字节拼接。</div>
        </div>
      </div>
      </div>
    </div>
  )
}
