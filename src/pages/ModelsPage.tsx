import { useEffect, useMemo, useRef, useState } from 'react'
import { Cpu, Download, Loader2, Power, PowerOff, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { ChatModels, GpuRuntimeState, RuntimeState, SessionBinding } from '../types'

function gib(value: number | null) {
  if (!value || value <= 0) return '—'
  const gb = value / 1024 / 1024 / 1024
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(value / 1024 / 1024)} MB`
}

function expiresLabel(expiresAt: string | null) {
  if (!expiresAt) return '常驻'
  const at = new Date(expiresAt).getTime()
  if (Number.isNaN(at)) return '未知'
  const left = Math.round((at - Date.now()) / 60000)
  if (left <= 0) return '正在卸载'
  return `${left} 分钟后自动卸载`
}

/** 名称对上只认「相等」与「一边是另一边加冒号的开头」；与后端 ModelBinding 同口径。 */
function sameModel(a: string, b: string) {
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`)
}

/**
 * 「我的模型」页：本机模型的启动与关闭。
 *
 * 与「模型库」的分工：模型库管「装什么」，这一页管「跑什么」。会话绑的是这一页启动的那一份，
 * 所以换模型必须回到这里先关再开——不在对话页给下拉，因为中途换模型会让历史整段重算，
 * 那个代价不该藏在下拉里。
 *
 * 4.2 起这一页改成「一份模型一张卡，原地改状态」：旧版把运行中与可启动分成两套网格，
 * 启动 / 关闭时卡片会在两段之间跳，页面高度也跟着抖；单列稳定排序后，启停只改卡片里的
 * 状态和按钮，不再搬动卡片。
 */
export function ModelsPage({ toast, onOpenChat, onOpenLibrary }: {
  toast: (message: string) => void
  onOpenChat: () => void
  onOpenLibrary: () => void
}) {
  const [runtime, setRuntime] = useState<RuntimeState | null>(null)
  const [models, setModels] = useState<ChatModels | null>(null)
  const [sessions, setSessions] = useState<SessionBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busyName, setBusyName] = useState('')
  // 二次确认：只对「已经有别的驻留、还要再启动一份」这一步；启动没在跑的那份不需要确认。
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [gpuOffer, setGpuOffer] = useState<{ name: string; multiple: boolean } | null>(null)
  const [gpuState, setGpuState] = useState<GpuRuntimeState | null>(null)
  const [gpuInstallBusy, setGpuInstallBusy] = useState(false)
  const [gpuNote, setGpuNote] = useState('')

  // 并发 refresh 会乱序返回：只认最后一次发起的请求，旧响应不再覆盖新状态。
  const refreshSeq = useRef(0)
  // 运行态轮询与 refresh 也会互相覆盖：单独发一个号，谁后发谁算。
  const runtimeSeq = useRef(0)
  const lastRevision = useRef(-1)

  async function refresh(silent = false) {
    const seq = ++refreshSeq.current
    const runtimeToken = ++runtimeSeq.current
    if (!silent) setLoading(true)
    setRefreshing(true)
    try {
      const [state, chatModels, bindings] = await Promise.all([
        api.runtime(),
        api.chatModels(),
        api.sessionBindings(),
      ])
      if (seq !== refreshSeq.current || runtimeToken !== runtimeSeq.current) return
      setRuntime(state)
      setModels(chatModels)
      setSessions(bindings.sessions)
      lastRevision.current = Math.max(state.modelsRevision ?? 0, chatModels.revision ?? 0)
      setError('')
    } catch (e) {
      if (seq !== refreshSeq.current) return
      setError(e instanceof Error ? e.message : '读不到模型运行态')
    } finally {
      if (seq === refreshSeq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  /** 目录版本没变就只更新运行态；变了才重拉清单，避免每 4 秒都扫一次目录。 */
  async function poll() {
    const token = ++runtimeSeq.current
    try {
      const state = await api.runtime()
      if (token !== runtimeSeq.current) return
      if (state.modelsRevision !== lastRevision.current) {
        await refresh(true)
        return
      }
      setRuntime(state)
    } catch {
      // 轮询失败不弹错，下一次再试；手动刷新仍可立刻反馈。
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, 4000)
    return () => window.clearInterval(timer)
    // 只在挂载时启动；refresh / poll 只读 ref 与 setter，不依赖本次渲染的 state。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 启动 / 关闭期间每秒读一次运行态，把 llama-server 的加载进度带到卡片上。
  useEffect(() => {
    if (!busyName) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyName])

  // 安装 GPU 包期间单独轮询状态，让用户能看到下载/校验进度。
  useEffect(() => {
    if (!gpuInstallBusy) return
    const timer = window.setInterval(() => {
      void api.gpuRuntime().then(next => setGpuState(next)).catch(() => { /* 保留上一次状态 */ })
    }, 800)
    return () => window.clearInterval(timer)
  }, [gpuInstallBusy])

  const running = runtime?.running ?? []
  const installed = models?.models ?? []
  const names = useMemo(() => {
    const list = [...installed]
    for (const item of running) {
      if (!list.some(name => sameModel(name, item.name))) list.push(item.name)
    }
    return list
  }, [installed, running])

  const availableCount = names.filter(name => !running.some(item => sameModel(item.name, name))).length

  async function startModel(name: string, multiple: boolean) {
    setBusyName(name)
    try {
      const result = await api.loadModel(name, multiple)
      toast(result.message)
      if (!result.ok) setError(result.message)
      setConfirmLoad(null)
      setAllowMultiple(false)
      await refresh(true)
    } catch (e) {
      const text = e instanceof Error ? e.message : '启动失败'
      setError(text)
      toast(text)
    } finally {
      setBusyName('')
    }
  }

  async function load(name: string, multiple: boolean) {
    setConfirmLoad(null)
    // 安装 GPU 包时不能有模型在跑；已经有驻留就不再打断用户，直接用当前后端启动。
    if (running.length === 0) {
      try {
        const gpu = await api.gpuRuntime()
        if (gpu.prompt) {
          setGpuState(gpu)
          setGpuNote('')
          setGpuOffer({ name, multiple })
          return
        }
      } catch {
        // 读不到 GPU 状态不该阻止模型启动，直接按现有后端走。
      }
    }

    await startModel(name, multiple)
  }

  async function installGpuAndStart() {
    if (!gpuOffer) return
    setGpuInstallBusy(true)
    setGpuNote('')
    try {
      const result = await api.installGpuRuntime()
      setGpuState(result.status)
      if (!result.ok) {
        setGpuNote(result.message)
        return
      }
      toast(result.message)
      const offer = gpuOffer
      setGpuOffer(null)
      await startModel(offer.name, offer.multiple)
    } catch (e) {
      const text = e instanceof Error ? e.message : '安装显卡加速组件失败'
      setGpuNote(text)
    } finally {
      setGpuInstallBusy(false)
    }
  }

  async function skipGpuInstall() {
    const offer = gpuOffer
    if (!offer) return
    setGpuOffer(null)
    setGpuNote('')
    await startModel(offer.name, offer.multiple)
  }

  async function dismissGpuPrompt() {
    try {
      const result = await api.dismissGpuPrompt()
      setGpuState(result.status)
    } catch {
      // 记不住选择也不该阻止这次启动。
    }
    await skipGpuInstall()
  }

  async function unload(name: string) {
    setBusyName(name)
    try {
      const result = await api.unloadModel(name)
      toast(result.message)
      if (!result.ok) setError(result.message)
      await refresh(true)
    } catch (e) {
      const text = e instanceof Error ? e.message : '关闭失败'
      setError(text)
      toast(text)
    } finally {
      setBusyName('')
    }
  }

  async function remove(name: string) {
    const before = models
    setBusyName(name)
    setConfirmDelete(null)
    // 先乐观移除：文件删除后卡片立刻消失，不再等一次全量刷新才更新。
    setModels(current => current
      ? { ...current, models: current.models.filter(item => item !== name), revision: (current.revision ?? 0) + 1 }
      : current)
    try {
      const result = await api.deleteModel(name)
      toast(result.message)
      if (!result.ok) {
        setModels(before)
        setError(result.message)
        setConfirmDelete(name)
      } else {
        if (typeof result.revision === 'number') lastRevision.current = result.revision
        await refresh(true)
      }
    } catch (e) {
      setModels(before)
      const text = e instanceof Error ? e.message : '删除失败'
      setError(text)
      toast(text)
    } finally {
      setBusyName('')
    }
  }

  const boundSessions = (name: string) => sessions.filter(session => session.model && sameModel(session.model, name)).length
  const orphanModels = [...new Set(sessions
    .filter(session => session.model && !running.some(item => sameModel(item.name, session.model)))
    .map(session => session.model))]

  return (
    <div className="page models-page">
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">Runtime</div>
          <h1 className="page-title">我的模型</h1>
          <p className="page-sub">
            启动哪一份，对话与代理就用哪一份。本地模型换一份要重载权重、历史也要整段重算，所以会话一旦绑上就跟着它走到底；
            要换别的模型，先在这里关掉当前这份，再新建会话。
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'spin' : ''} />刷新
          </button>
        </div>
      </div>

      <section className="library-summary" aria-label="运行态">
        <div className="summary-main">
          <span className="summary-kicker">当前后端</span>
          <div className="summary-count">
            <strong>{loading && !runtime ? '—' : running.length}</strong>
            <small>份模型驻留</small>
          </div>
          <p>{runtime
            ? `${runtime.backend} · ${runtime.connected ? (runtime.detail || '已连接') : (runtime.detail || '未连接')}`
            : loading ? '正在读取运行态…' : '读不到运行态'}
          </p>
        </div>
        <div className="summary-tile">
          <span>推理预算</span>
          <b>{gib(running.reduce((total, item) => total + (item.sizeVramBytes ?? 0), 0))}</b>
          <small>{running.length ? '驻留模型占用（后端上报）' : '当前没有占用'}</small>
        </div>
        <div className="summary-tile">
          <span>可启动</span>
          <b>{loading && !models ? '—' : availableCount}</b>
          <small>{loading && !models ? '正在读取本机模型…' : installed.length ? `本机可用 ${installed.length} 份` : '本机没有可用模型'}</small>
        </div>
      </section>

      {error && <div className="empty-state" style={{ padding: '12px 16px', textAlign: 'left', marginBottom: 12, color: 'var(--danger)' }}>{error}</div>}

      {gpuOffer && (
        <div className="gpu-offer">
          <div className="gpu-offer-copy">
            <span className="gpu-offer-icon" aria-hidden><Download size={16} /></span>
            <div>
              <b>检测到可用的 Vulkan，安装显卡加速组件？</b>
              <span>
                约 33 MB。安装后启动模型会优先用显卡，失败会自动回退 CPU；现在先用 CPU 启动也不影响。
              </span>
              {gpuState?.busy && (
                <div className="model-progress inline" style={{ marginTop: 8 }}>
                  <Loader2 className="spin" />
                  <span>{gpuState.phase === 'downloading' ? '正在下载' : gpuState.phase === 'installing' ? '正在安装' : '正在校验'} · {Math.round(gpuState.progress * 100)}%</span>
                </div>
              )}
              {gpuNote && <div className="gpu-offer-error">{gpuNote}</div>}
            </div>
          </div>
          <div className="gpu-offer-actions">
            {!gpuState?.busy && (
              <>
                <button className="btn primary sm" disabled={gpuInstallBusy} onClick={() => void installGpuAndStart()}><Download />安装并启动</button>
                <button className="btn ghost sm" disabled={gpuInstallBusy} onClick={() => void skipGpuInstall()}>以后再说</button>
                <button className="btn ghost sm" disabled={gpuInstallBusy} onClick={() => void dismissGpuPrompt()}>不再提示</button>
              </>
            )}
            {gpuState?.busy && (
              <button className="btn ghost sm" onClick={() => void api.cancelGpuRuntime().then(setGpuState).catch(() => {})}>取消安装</button>
            )}
          </div>
        </div>
      )}

      {runtime && !runtime.connected && (
        <div className="first-run-tip" style={{ marginBottom: 14 }}>
          <span className="first-run-icon" aria-hidden><Cpu size={15} /></span>
          <div className="first-run-copy">
            <b>没有连上任何推理后端</b>
            <span>装好本机 Ollama，或把 llama-server 放进内置运行时目录；也可以在「设置」里改后端选择。连上之后这里才会列出可启动的模型。</span>
          </div>
        </div>
      )}

      <div className="section-head">
        <div>
          <h2>本机模型</h2>
          <p>{runtime?.canControl
            ? '启动后一直驻留，避免下一次请求临时重新加载；关掉才会释放内存。'
            : '这个后端的模型驻留由服务自己管理，天枢不接管启停。'}</p>
        </div>
        <div className="section-actions">
          <span className={running.length ? 'chip success' : 'chip'}>{running.length ? `${running.length} 份驻留` : '没有驻留'}</span>
          <button className="btn ghost sm" onClick={onOpenLibrary}><Cpu />去模型库下载</button>
        </div>
      </div>

      {loading && !models
        ? (
          <div className="model-grid" aria-busy="true">
            {[0, 1].map(index => (
              <article className="model-card skeleton" key={index} aria-hidden>
                <div className="model-top">
                  <div className="model-avatar skeleton-avatar shimmer" />
                  <div className="model-title">
                    <div className="skeleton-line shimmer" style={{ width: '62%' }} />
                    <div className="skeleton-line shimmer" style={{ width: '38%', marginTop: 8 }} />
                  </div>
                  <div className="skeleton-pill shimmer" />
                </div>
                <div className="model-foot">
                  <div className="skeleton-line shimmer" style={{ width: '48%' }} />
                </div>
              </article>
            ))}
          </div>
        )
        : names.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-state-icon"><ShieldCheck /></div>
            <h3>本机没有可用模型</h3>
            <p>到「模型库」按本机内存与显存挑一个可运行的量化档位，下载完成后回到这里启动。</p>
            <button className="btn primary empty-cta" onClick={onOpenLibrary}>前往模型库</button>
          </div>
        )
        : (
          <div className="model-grid">
            {names.map(name => {
              const run = running.find(item => sameModel(item.name, name))
              const isBusy = busyName === name
              return (
                <article className="model-card" key={name}>
                  <div className="model-top">
                    <div className="model-avatar">{run ? <Power size={18} /> : name.slice(0, 1).toUpperCase()}</div>
                    <div className="model-title">
                      <div className="model-name">{run?.name ?? name}</div>
                      {isBusy ? (
                        <div className="model-progress inline">
                          <Loader2 className="spin" />
                          <span>{runtime?.progress || (run ? '正在关闭模型…' : '正在启动模型…')}</span>
                        </div>
                      ) : (
                        <div className="model-pub">
                          {run
                            ? (run.contextLength ? `窗口 ${run.contextLength.toLocaleString()} tokens` : '窗口未知（后端没报）')
                            : '未驻留 · 启动后才能对话'}
                        </div>
                      )}
                    </div>
                    <span className={`chip ${run ? (run.resident ? 'success' : 'warn') : ''}`}>
                      {run ? expiresLabel(run.expiresAt) : '可用'}
                    </span>
                  </div>

                  {run && (
                    <div className="model-meta">
                      <div className="meta-field"><span className="meta-label">占用显存</span><b className="meta-value">{gib(run.sizeVramBytes)}</b></div>
                      <div className="meta-field"><span className="meta-label">绑定会话</span><b className="meta-value">{boundSessions(name)}</b></div>
                      <div className="meta-field"><span className="meta-label">后端</span><b className="meta-value">{runtime?.backend ?? '—'}</b></div>
                    </div>
                  )}

                  <div className="model-foot">
                    {run ? (
                      <>
                        <span className="source">关掉后，绑着它的旧会话不能继续发消息，需要新建会话；模型文件可在关闭后删除。</span>
                        <span className="grow" />
                        {runtime?.canControl && (
                          <button className="btn ghost sm" disabled={isBusy} onClick={() => void unload(name)}>
                            {isBusy ? <Loader2 className="spin" /> : <PowerOff />}关闭
                          </button>
                        )}
                      </>
                    ) : confirmDelete === name ? (
                      <div className="delete-confirm">
                        <span className="note">
                          删除会把磁盘上的 GGUF 和下载记录一起移除，不能恢复。
                          {boundSessions(name) > 0 ? ` 有 ${boundSessions(name)} 个会话绑着这份；删除后这些会话不能继续。` : ''}
                        </span>
                        <div className="delete-confirm-actions">
                          <button className="btn ghost sm" onClick={() => setConfirmDelete(null)}>取消</button>
                          <button className="btn danger sm" disabled={isBusy} onClick={() => void remove(name)}>
                            {isBusy ? <Loader2 className="spin" /> : <Trash2 />}确认删除
                          </button>
                        </div>
                      </div>
                    ) : confirmLoad === name ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                        <span className="note">
                          {running.length
                            ? `已经有 ${running.map(item => item.name).join('、')} 在跑。建议先关掉它再启动；确实要同时驻留，就勾下面这一项。`
                            : '启动会把这份权重读进内存，大模型可能要等几十秒到几分钟。'}
                        </span>
                        {running.length > 0 && (
                          <label className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input type="checkbox" checked={allowMultiple} onChange={e => setAllowMultiple(e.target.checked)} />
                            同时驻留两份（我知道可能顶爆内存）
                          </label>
                        )}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn ghost sm" onClick={() => { setConfirmLoad(null); setAllowMultiple(false) }}>取消</button>
                          <button className="btn primary sm" disabled={isBusy} onClick={() => void load(name, allowMultiple)}>
                            {isBusy ? <Loader2 className="spin" /> : <Power />}确认启动
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="source">{running.length ? '会先要你确认是否同时驻留' : '启动后新会话默认绑它'}</span>
                        <span className="grow" />
                        <button className="btn danger sm" disabled={isBusy} onClick={() => { setConfirmLoad(null); setConfirmDelete(name) }}>
                          <Trash2 />删除
                        </button>
                        {runtime?.canControl !== false && (
                          <button className="btn primary sm" disabled={isBusy} onClick={() => setConfirmLoad(name)}>
                            <Power />启动
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}

      {orphanModels.length > 0 && (
        <div className="first-run-tip" style={{ marginTop: 18 }}>
          <span className="first-run-icon" aria-hidden><PowerOff size={15} /></span>
          <div className="first-run-copy">
            <b>有旧会话绑着已经关掉的模型</b>
            <span>
              {orphanModels.join('、')}
              {' '}那份模型不在了。旧会话不会自动改用别的那一份——在对话页新建一个会话，或把刚才关掉的这份重新启动。
            </span>
          </div>
        </div>
      )}

      {running.length > 0 && (
        <div className="settings-index-note">
          <button className="btn ghost sm" onClick={onOpenChat}>回对话页继续</button>
        </div>
      )}
    </div>
  )
}
