import { useEffect, useMemo, useState } from 'react'
import { Cpu, Loader2, Power, PowerOff, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import type { ChatModels, RuntimeState, StoredSession } from '../types'

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

/**
 * 「我的模型」页：本机模型的启动与关闭。
 *
 * 与「模型库」的分工：模型库管「装什么」，这一页管「跑什么」。会话绑的是这一页启动的那一份，
 * 所以换模型必须回到这里先关再开——不在对话页给下拉，因为中途换模型会让历史整段重算，
 * 那个代价不该藏在下拉里。
 */
export function ModelsPage({ toast, onOpenChat, onOpenLibrary }: {
  toast: (message: string) => void
  onOpenChat: () => void
  onOpenLibrary: () => void
}) {
  const [runtime, setRuntime] = useState<RuntimeState | null>(null)
  const [models, setModels] = useState<ChatModels | null>(null)
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyName, setBusyName] = useState('')
  // 二次确认：只对「已经有别的驻留、还要再启动一份」这一步；启动没在跑的那份不需要确认。
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [allowMultiple, setAllowMultiple] = useState(false)

  async function refresh(silent = false) {
    if (!silent) setLoading(true)
    try {
      const [state, chatModels, list] = await Promise.all([api.runtime(), api.chatModels(), api.sessions()])
      setRuntime(state)
      setModels(chatModels)
      setSessions(list.sessions)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读不到模型运行态')
    } finally {
      if (!silent) setLoading(false)
      else setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const running = runtime?.running ?? []
  const installed = models?.models ?? []
  // 「装了但没在跑」按后端给的名字列；驻留的那几份从这一列里剔掉，同一份不出现两次。
  const idle = useMemo(() => installed.filter(name => !running.some(item =>
    item.name === name || item.name.startsWith(`${name}:`) || name.startsWith(`${item.name}:`))), [installed, running])

  async function load(name: string, multiple: boolean) {
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

  const boundSessions = (name: string) => sessions.filter(session => session.model === name).length

  return (
    <div className="page">
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
          <button className="btn ghost" onClick={() => void refresh()}><RefreshCw />刷新</button>
        </div>
      </div>

      <section className="library-summary" aria-label="运行态">
        <div className="summary-main">
          <span className="summary-kicker">当前后端</span>
          <div className="summary-count">
            <strong>{running.length}</strong>
            {/* 原先三个三元分支返回同一个字符串（编辑残留）：这里本想做单复数，
                中文不需要，就一句写清它数的是什么——驻留份数，不是后端个数。 */}
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
          <b>{idle.length}</b>
          <small>{installed.length ? `本机可用 ${installed.length} 份` : '本机没有可用模型'}</small>
        </div>
      </section>

      {error && <div className="empty-state" style={{ padding: '12px 16px', textAlign: 'left', marginBottom: 12, color: 'var(--danger)' }}>{error}</div>}

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
          <h2>正在运行</h2>
          <p>{runtime?.canControl ? '关掉才会释放内存；不关就一直驻留，避免下一次请求临时重新加载。' : '这个后端的模型驻留由服务自己管理，天枢不接管启停。'}</p>
        </div>
        <span className={running.length ? 'chip success' : 'chip'}>{running.length ? `${running.length} 份驻留` : '没有驻留'}</span>
      </div>

      {running.length === 0
        ? <div className="empty-state"><div className="empty-state-icon"><Power /></div><h3>现在没有驻留的模型</h3><p>在下面的「本机能用」里启动一份，再回对话页发消息。</p></div>
        : (
          <div className="model-grid">
            {running.map(item => (
              <article className="model-card" key={item.name}>
                <div className="model-top">
                  <div className="model-avatar"><Power size={18} /></div>
                  <div className="model-title">
                    <div className="model-name">{item.name}</div>
                    <div className="model-pub">{item.contextLength ? `窗口 ${item.contextLength.toLocaleString()} tokens` : '窗口未知（后端没报）'}</div>
                  </div>
                  <span className={`chip ${item.resident ? 'success' : 'warn'}`}>{expiresLabel(item.expiresAt)}</span>
                </div>
                <div className="model-meta">
                  <div className="meta-field"><span className="meta-label">占用显存</span><b className="meta-value">{gib(item.sizeVramBytes)}</b></div>
                  <div className="meta-field"><span className="meta-label">绑定会话</span><b className="meta-value">{boundSessions(item.name)}</b></div>
                  <div className="meta-field"><span className="meta-label">后端</span><b className="meta-value">{runtime?.backend ?? '—'}</b></div>
                </div>
                <div className="model-foot">
                  <span className="source">关掉后，绑着它的旧会话不能继续发消息，需要新建会话。</span>
                  <span className="grow" />
                  {runtime?.canControl && (
                    <button className="btn ghost sm" disabled={busyName === item.name} onClick={() => void unload(item.name)}>
                      {busyName === item.name ? <Loader2 className="spin" /> : <PowerOff />}关闭
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

      <div className="section-head" style={{ marginTop: 26 }}>
        <div>
          <h2>本机能用</h2>
          <p>装好但还没驻留的模型。启动一份即可开始对话；已有驻留时先关掉那一份，同时驻两份在单张显卡上容易把内存顶爆。</p>
        </div>
        <button className="btn ghost sm" onClick={onOpenLibrary}><Cpu />去模型库下载</button>
      </div>

      {installed.length === 0
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
            {idle.map(name => (
              <article className="model-card" key={name}>
                <div className="model-top">
                  <div className="model-avatar">{name.slice(0, 1).toUpperCase()}</div>
                  <div className="model-title">
                    <div className="model-name">{name}</div>
                    <div className="model-pub">未驻留 · 启动后才能对话</div>
                  </div>
                  <span className="chip">可用</span>
                </div>
                <div className="model-foot">
                  {confirmLoad === name ? (
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
                        <button className="btn primary sm" disabled={busyName === name} onClick={() => void load(name, allowMultiple)}>
                          {busyName === name ? <Loader2 className="spin" /> : <Power />}确认启动
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="source">{running.length ? '会先要你确认是否同时驻留' : '启动后新会话默认绑它'}</span>
                      <span className="grow" />
                      <button className="btn primary sm" disabled={busyName === name} onClick={() => setConfirmLoad(name)}>
                        <Power />启动
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

      {sessions.some(session => session.model && !running.some(item => item.name === session.model)) && (
        <div className="first-run-tip" style={{ marginTop: 18 }}>
          <span className="first-run-icon" aria-hidden><PowerOff size={15} /></span>
          <div className="first-run-copy">
            <b>有旧会话绑着已经关掉的模型</b>
            <span>
              {[...new Set(sessions.filter(session => session.model && !running.some(item => item.name === session.model)).map(session => session.model))]
                .join('、')}
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
