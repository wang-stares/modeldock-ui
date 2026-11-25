import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ChevronRight, Cpu, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { api } from '../api'
import { HardwarePopover } from '../components/HardwarePopover'
import type { CatalogModel, DownloadJob, HardwareProfile, ModelFit, ModelSourcesState, ModelVariant, Recommendation } from '../types'

function bytes(value: number | null | undefined) {
  if (!value) return '—'
  const gb = value / 1024 / 1024 / 1024
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(value / 1024 / 1024)} MB`
}
function downloads(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}
function sourceLabel(kind: number) {
  if (kind === 0) return '魔搭'
  if (kind === 2) return '魔搭国际'
  if (kind === 3) return 'OpenCSG'
  return 'Hugging Face'
}
function sourcesLabel(model: CatalogModel) {
  return model.sources.map(sourceLabel).join(' · ')
}
function clientFit(size: number, hw: HardwareProfile | null): ModelFit | null {
  if (!hw?.budgetGb) return null
  const required = size / 1024 / 1024 / 1024 * 1.15 + 0.8
  const ratio = required / hw.budgetGb
  if (hw.freeDiskBytes > 0 && hw.freeDiskBytes < size * 1.2) {
    return { level: 0, requiredGb: required, budgetGb: hw.budgetGb, reason: `磁盘剩余 ${hw.freeDiskGb.toFixed(1)} GB，不足以存放该模型文件`, label: '不可运行', usable: false }
  }
  if (ratio <= 0.55) return { level: 3, requiredGb: required, budgetGb: hw.budgetGb, reason: `约占 ${required.toFixed(1)} GB，本机可用 ${hw.budgetGb.toFixed(1)} GB，运行余量充足`, label: '推荐运行', usable: true }
  if (ratio <= 0.95) return { level: 2, requiredGb: required, budgetGb: hw.budgetGb, reason: `约占 ${required.toFixed(1)} GB，接近本机可用 ${hw.budgetGb.toFixed(1)} GB，建议关闭占用较高的其他程序`, label: '可运行', usable: true }
  if (ratio <= 1.2) return { level: 1, requiredGb: required, budgetGb: hw.budgetGb, reason: `约占 ${required.toFixed(1)} GB，已超过本机可用 ${hw.budgetGb.toFixed(1)} GB，预计生成速度明显下降`, label: '受限运行', usable: true }
  return { level: 0, requiredGb: required, budgetGb: hw.budgetGb, reason: `需要约 ${required.toFixed(1)} GB，本机可用 ${hw.budgetGb.toFixed(1)} GB，超出本机资源预算`, label: '不可运行', usable: false }
}
function fitClass(fit: ModelFit | null) {
  if (!fit) return ''
  return [3, 2, 1, 0].includes(fit.level) ? ['comfortable', 'workable', 'tight', 'too-large'][3 - fit.level] : ''
}
function fitChip(fit: ModelFit | null) {
  if (!fit) return { cls: '', label: '待检测' }
  return { cls: fit.level === 3 ? 'success' : fit.level === 2 ? 'accent' : fit.level === 1 ? 'warn' : 'danger', label: fit.label }
}
function avatarText(model: CatalogModel) {
  const clean = model.displayName.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '')
  return clean.slice(0, 1).toUpperCase() || model.publisher.slice(0, 1).toUpperCase() || 'M'
}

export function LibraryPage({ hardware, onHardware, jobs, toast }: {
  hardware: HardwareProfile | null
  onHardware: () => void
  jobs: DownloadJob[]
  toast: (message: string) => void
}) {
  const [mode, setMode] = useState<'recommend' | 'all'>('recommend')
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  // 后台校准的序号：只让最后一次 loadRecommend 发起的校准生效。
  const refineSeq = useRef(0)
  const [models, setModels] = useState<CatalogModel[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState('')
  const [hwOpen, setHwOpen] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [page, setPage] = useState(1)
  const [sourceState, setSourceState] = useState<ModelSourcesState | null>(null)
  const [hasChatModel, setHasChatModel] = useState(false)

  useEffect(() => {
    let alive = true
    void api.sources().then(state => {
      if (alive) setSourceState(state)
    }).catch(() => { /* 读不到就按来源设置页自己的提示处理，不影响模型列表 */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    void api.chatModels().then(data => {
      if (alive) setHasChatModel(data.models.length > 0)
    }).catch(() => { /* 读不到对话模型就按没有处理，不影响模型库本身 */ })
    return () => { alive = false }
  }, [])

  async function loadRecommend() {
    setLoading(true); setWarning('')
    try {
      const data = await api.recommend()
      setRecommendations(data)
      // 首屏只按文件大小估；GGUF 头里的层数/KV 头数要真去读，读到后按 key 替换对应卡，慢也不挡首屏。
      // 校准期间用户又点了重新拉取/切来源时，旧校准结果直接丢掉，别把上一轮的口径盖回来。
      const seq = ++refineSeq.current
      void api.refine().then(refined => {
        if (seq !== refineSeq.current || !refined.length) return
        setRecommendations(prev => {
          const byKey = new Map(refined.map(item => [item.model.key, item]))
          return prev.map(item => byKey.get(item.model.key) ?? item)
        })
      }).catch(() => { /* 校准失败就保持旧口径，不弹错 */ })
    } catch (e) {
      setWarning(e instanceof Error ? e.message : '模型来源暂时不可用')
    } finally { setLoading(false) }
  }

  async function loadAll(search: string, pageNo = 1, append = false) {
    setLoading(true); setWarning('')
    try {
      const data = await api.search(search, pageNo, 24)
      setModels(prev => append ? [...prev, ...data.models] : data.models)
      setPage(pageNo)
      if (data.warning) setWarning(data.warning)
    } catch (e) {
      setWarning(e instanceof Error ? e.message : '模型来源暂时不可用')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadRecommend() }, [])
  useEffect(() => {
    if (mode !== 'all') return
    const timer = window.setTimeout(() => { void loadAll(query, 1, false) }, 420)
    return () => window.clearTimeout(timer)
  }, [mode, query])

  const activeJobs = jobs.filter(job => job.isRunning)
  const hasModel = hasChatModel || jobs.some(job => job.state === 1)
  const displayModels = useMemo(() => {
    if (mode === 'recommend') return []
    return models
  }, [mode, models])

  async function startDownload(model: CatalogModel, variant?: ModelVariant) {
    setBusyKey(model.key)
    try {
      let pick = variant ?? model.variants[0]
      if (!pick) {
        const loaded = await api.variants(model.key)
        pick = loaded.variants[0]
        if (!pick) throw new Error('这个模型没有可单独下载的 GGUF 档位')
      }
      if (!pick.hasChecksum) throw new Error('这个档位没有源端 SHA256，无法确认文件与源一致，已拒绝下载')
      await api.startDownload(model.key, pick.fileName)
      toast(`已开始下载 ${pick.quantization} · ${bytes(pick.sizeBytes)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载启动失败')
    } finally { setBusyKey('') }
  }

  function isRunning(fileName: string) {
    return activeJobs.some(job => job.fileName === fileName)
  }

  const activeSources = sourceState?.sources.filter(source => source.ready) ?? []
  const pendingSources = sourceState?.sources.filter(source => source.enabled && !source.ready) ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">Model library</div>
          <h1 className="page-title">模型库</h1>
          <p className="page-sub">{sourceState === null
            ? '正在读取模型来源设置…'
            : activeSources.length > 0
              ? `从${activeSources.map(source => source.name).join('、')}获取 GGUF 模型，按本机内存与显存筛选可运行的量化档位，并核验完整档位信息；下载前由你确认许可证与体积。`
              : pendingSources.length > 0
                ? '当前没有可用模型来源；OpenCSG 已开启但待配置 Access Token。请先配置凭据，或在「设置 → 模型来源」中开启其他来源。'
                : '尚未启用模型来源。请先在「设置 → 模型来源」中开启至少一个来源，模型库才会开始获取目录。'}</p>
        </div>
        <div className="head-actions" style={{ position: 'relative' }}>
          <button className="btn ghost" onClick={() => setHwOpen(v => !v)}><Cpu />设备信息</button>
          <button className="btn primary" onClick={() => { if (mode === 'recommend') void loadRecommend(); else void loadAll(query, 1, false) }}>
            <RefreshCw />刷新目录
          </button>
          {hwOpen && <HardwarePopover hardware={hardware} onClose={() => setHwOpen(false)} />}
        </div>
      </div>

      <section className="library-summary" aria-label="本机适配评估">
        <div className="summary-main">
          <span className="summary-kicker">本机适配评估</span>
          <div className="summary-count">
            <strong>{mode === 'recommend' ? (loading ? '—' : recommendations.length) : (loading ? '—' : models.length)}</strong>
            <small>{mode === 'recommend' ? '个推荐模型' : '条目录记录'}</small>
          </div>
          <p>{hardware ? `依据 ${hardware.ramGb.toFixed(0)} GB 内存与 ${hardware.budgetGb.toFixed(1)} GB 推理预算排序。` : '正在读取设备信息与推理预算。'}</p>
        </div>
        <div className="summary-tile">
          <span>推理预算</span>
          <b>{hardware ? `${hardware.budgetGb.toFixed(1)} GB` : '—'}</b>
          <small>{hardware?.hasGpu ? `${hardware.gpuName} · 显存优先` : 'CPU 推理'}</small>
        </div>
        <div className="summary-tile">
          <span>模型来源</span>
          <b>{sourceState ? `${sourceState.readyCount} 个来源` : '—'}</b>
          <small>{sourceState
            ? `${activeSources.map(source => source.name).join(' · ') || (pendingSources.length ? '暂无可用来源' : '未启用任何来源')}${pendingSources.length ? ` · ${pendingSources.map(source => source.name).join('、')}待配置` : ''}`
            : '正在读取来源设置'}</small>
        </div>
      </section>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="模型列表范围">
          <button role="tab" aria-selected={mode === 'recommend'} data-tour="library-recommend-tab" className={mode === 'recommend' ? 'active' : ''} onClick={() => setMode('recommend')}>推荐</button>
          <button role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>全部</button>
        </div>
        {mode === 'all' && (
          <label className="search">
            <Search />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型，例如 qwen、llama、deepseek" aria-label="搜索模型" />
            {query && <button className="btn ghost icon sm" onClick={() => setQuery('')} aria-label="清空搜索"><X /></button>}
          </label>
        )}
        <div className="toolbar-right">
          {hardware ? <><span className="hw-cpu">{hardware.cpuName?.replace(/(Intel|AMD)/, '$1') || '本机'}</span><span className="hw-sep">·</span><span>{hardware.ramGb.toFixed(0)} GB 内存</span>{hardware.hasGpu && <><span className="hw-sep">·</span><span className="hw-gpu">{hardware.gpuName}</span></>}</> : '正在读取设备信息…'}
        </div>
      </div>

      {warning && <div className="empty-state" style={{ padding: '12px 16px', textAlign: 'left', marginBottom: 12, color: 'var(--warn)' }}>{warning}</div>}

      <div className="section-head">
        <div>
          <h2>{mode === 'recommend' ? '本机推荐' : '全部模型'}</h2>
          <p>{mode === 'recommend' ? '仅展示可在本机运行的量化档位，点击即可下载。' : '按下载热度排序；输入关键词并回车可筛选源站目录。'}</p>
        </div>
        <span className="chip accent">{mode === 'recommend' ? '按推理预算排序' : '源站目录'}</span>
      </div>

      {mode === 'recommend' && !hasModel && !loading && recommendations.length > 0 && (
        <div className="first-run-tip">
          <span className="first-run-icon" aria-hidden><Sparkles size={15} /></span>
          <div className="first-run-copy">
            <b>未检测到本地可用模型，建议先选择「推荐运行」的模型</b>
            <span>优先选择 2–5 GB 的 7B 级 Q4 模型；点击右下角「下载」，完成后在「对话」中选择该模型。</span>
          </div>
        </div>
      )}

      {mode === 'recommend' ? (
        <div className="model-grid">
          {loading && recommendations.length === 0 ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="model-card shimmer" style={{ height: 210 }} />) : recommendations.map((rec, index) => {
            const fit = rec.fit
            const chip = fitChip(fit)
            const ratio = fit ? Math.min(1, fit.requiredGb / Math.max(fit.budgetGb, 0.01)) : 0
            return (
              <article className="model-card" key={rec.model.key} data-tour={index === 0 ? 'library-first' : undefined}>
                <div className="model-top">
                  <div className="model-avatar" aria-hidden>{avatarText(rec.model)}</div>
                  <div className="model-title">
                    <div className="model-name">{rec.model.displayName}</div>
                    <div className="model-pub">{rec.model.publisher} · {rec.model.parameterLabel}</div>
                  </div>
                  <span className={`chip ${chip.cls} fit-pill`}>{chip.label}</span>
                </div>
                <div className="model-meta">
                  <div className="meta-field"><span className="meta-label">体积</span><span className="meta-value">{bytes(rec.variant.sizeBytes)}</span></div>
                  <div className="meta-field"><span className="meta-label">档位</span><span className="meta-value">{rec.variant.quantization}</span></div>
                  <div className="meta-field"><span className="meta-label">下载</span><span className="meta-value">{downloads(rec.model.downloads)}</span></div>
                  <div className="meta-field"><span className="meta-label">来源</span><span className="meta-value">{sourcesLabel(rec.model)}</span></div>
                </div>
                <div className={`fit-track ${fitClass(fit)}`}><i style={{ width: `${Math.max(8, ratio * 100)}%` }} /></div>
                <p className="model-reason">{fit?.reason}</p>
                <div className="model-foot">
                  <span className={`chip ${rec.model.commercialUse ? 'success' : 'warn'}`}>{rec.model.commercialUse ? '可商用' : '商用需确认'}</span>
                  <span className="source">{rec.model.license}</span>
                  <span className="grow" />
                  <button className="btn primary sm" disabled={busyKey === rec.model.key || isRunning(rec.variant.fileName)} onClick={() => void startDownload(rec.model, rec.variant)}>
                    {busyKey === rec.model.key ? <Loader2 className="spin" /> : isRunning(rec.variant.fileName) ? <Loader2 className="spin" /> : <ArrowDownToLine />}
                    {isRunning(rec.variant.fileName) ? '下载中' : '下载'}
                  </button>
                </div>
              </article>
            )
          })}
          {!loading && recommendations.length === 0 && <div className="empty-state"><h3>暂无推荐结果</h3><p>调整搜索词，或切换到「全部」浏览源站目录。</p></div>}
        </div>
      ) : (
        <>
          <div className="model-grid">
            {loading && displayModels.length === 0 ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="model-card shimmer" style={{ height: 190 }} />) : displayModels.map(model => {
              const first = model.variants[0]
              const fit = first ? clientFit(first.sizeBytes, hardware) : null
              const chip = fitChip(fit)
              return (
                <article className="model-card" key={model.key}>
                  <div className="model-top">
                    <div className="model-avatar" aria-hidden>{avatarText(model)}</div>
                    <div className="model-title">
                      <div className="model-name">{model.displayName}</div>
                      <div className="model-pub">{model.publisher} · {model.parameterLabel} · {downloads(model.downloads)} 次下载</div>
                    </div>
                    <span className={`chip ${chip.cls} fit-pill`}>{chip.label}</span>
                  </div>
                  <div className="model-meta">
                    <div className="meta-field"><span className="meta-label">档位</span><span className="meta-value">{first?.quantization ?? '待获取'}</span></div>
                    <div className="meta-field"><span className="meta-label">体积</span><span className="meta-value">{first ? bytes(first.sizeBytes) : '—'}</span></div>
                    <div className="meta-field"><span className="meta-label">来源</span><span className="meta-value">{sourcesLabel(model)}</span></div>
                  </div>
                  <p className="model-reason">{fit?.reason ?? '下载时会获取该仓库的完整量化档位，并按本机资源预算自动选择一档。'}</p>
                  <div className="model-foot">
                    <span className={`chip ${model.commercialUse ? 'success' : 'warn'}`}>{model.commercialUse ? '可商用' : '商用需确认'}</span>
                    <span className="source">{model.license}</span>
                    <span className="grow" />
                    <button className="btn ghost sm" onClick={async () => {
                      try {
                        const loaded = await api.variants(model.key)
                        setModels(prev => prev.map(m => m.key === model.key ? loaded : m))
                      } catch (e) { toast(e instanceof Error ? e.message : '拉取档位失败') }
                    }}>档位<ChevronRight /></button>
                    <button className="btn primary sm" disabled={busyKey === model.key || (first ? isRunning(first.fileName) : false)} onClick={() => void startDownload(model)}>
                      {busyKey === model.key ? <Loader2 className="spin" /> : <ArrowDownToLine />}下载
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
          {displayModels.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button className="btn ghost" disabled={loading} onClick={() => void loadAll(query, page + 1, true)}>
                {loading ? <Loader2 className="spin" /> : null}继续加载
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
