import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, Boxes, CircleStop, Cpu, Loader2, MessageSquarePlus, Sparkles, Trash2, Wrench } from 'lucide-react'
import { api, streamChat } from '../api'
import type { ChatModels, ChatResult, StoredSession, StoredTurn } from '../types'

interface UiMessage { role: 'user' | 'assistant'; content: string; thinking?: string; meta?: string }

const starters = [
  '你好，帮我介绍一下你自己',
  '用三句话解释模型量化',
  '帮我写一封简短的请假邮件',
]

function toUi(turns: StoredTurn[]): UiMessage[] {
  return turns.filter(t => t.role === 1 || t.role === 2).map(t => ({ role: t.role === 1 ? 'user' : 'assistant', content: t.content, thinking: t.thinking }))
}
function newId() { return `local-${Date.now().toString(36)}` }
function timeLabel(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ChatPage({ toast, onOpenLibrary }: { toast: (message: string) => void; onOpenLibrary: () => void }) {
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [models, setModels] = useState<ChatModels | null>(null)
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChatResult | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const active = sessions.find(s => s.id === activeId) || null
  const hasModels = Boolean(models && models.models.length > 0)
  const canSend = input.trim().length > 0 && !sending && model.length > 0

  useEffect(() => {
    let alive = true
    async function boot() {
      try {
        const [list, chatModels] = await Promise.all([api.sessions(), api.chatModels()])
        if (!alive) return
        setSessions(list.sessions)
        setModels(chatModels)
        setModel(chatModels.models[0] ?? '')
        const pick = list.lastSessionId && list.sessions.some(s => s.id === list.lastSessionId)
          ? list.lastSessionId
          : list.sessions[0]?.id
        if (pick) {
          setActiveId(pick)
          const found = list.sessions.find(s => s.id === pick)
          setMessages(found ? toUi(found.turns) : [])
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '对话内核未启动')
      } finally { if (alive) setLoading(false) }
    }
    void boot()
    return () => { alive = false }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, streamText])

  async function refreshSessions(prefer = activeId) {
    try {
      const list = await api.sessions()
      setSessions(list.sessions)
      const pick = prefer && list.sessions.some(s => s.id === prefer) ? prefer : (list.sessions[0]?.id ?? '')
      setActiveId(pick)
      const found = list.sessions.find(s => s.id === pick)
      setMessages(found ? toUi(found.turns) : [])
    } catch { /* list refresh is non-fatal */ }
  }

  async function createSession() {
    try {
      const session = await api.createSession('新会话')
      setSessions(prev => [session, ...prev])
      setActiveId(session.id)
      setMessages([])
      setResult(null)
      setError('')
    } catch (e) { toast(e instanceof Error ? e.message : '新建会话失败') }
  }

  function openSession(session: StoredSession) {
    if (sending) return
    setActiveId(session.id)
    setMessages(toUi(session.turns))
    setResult(null)
    setError('')
    setStreamText('')
  }

  async function deleteSession(id: string) {
    if (sending) return
    try {
      await api.deleteSession(id)
      const left = sessions.filter(s => s.id !== id)
      setSessions(left)
      if (activeId === id) {
        const next = left[0]
        setActiveId(next?.id ?? '')
        setMessages(next ? toUi(next.turns) : [])
      }
    } catch (e) { toast(e instanceof Error ? e.message : '删除会话失败') }
  }

  async function send() {
    const content = input.trim()
    if (!content || sending) return
    let sessionId = activeId
    if (!sessionId) {
      try {
        const created = await api.createSession(content.slice(0, 24) || '新会话')
        sessionId = created.id
        setSessions(prev => [created, ...prev])
        setActiveId(created.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : '新建会话失败')
        return
      }
    }
    setInput('')
    setSending(true)
    setError('')
    setStreamText('')
    setResult(null)
    setMessages(prev => [...prev, { role: 'user', content }])
    const controller = new AbortController()
    abortRef.current = controller
    let assembled = ''
    try {
      await streamChat({ sessionId, model, content }, chunk => {
        if (chunk.type === 'delta' && chunk.text) {
          assembled += chunk.text
          setStreamText(assembled)
        } else if (chunk.type === 'done' && chunk.result) {
          const final = chunk.result
          const finalText = final.text || assembled
          setResult(final)
          setMessages(prev => [...prev, { role: 'assistant', content: finalText, thinking: final.thinking }])
          setStreamText('')
          if (final.error) setError(final.error)
        } else if (chunk.type === 'error') {
          setError(chunk.text || '生成失败')
        }
      }, controller.signal)
      void refreshSessions(sessionId)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  function stop() { abortRef.current?.abort() }

  const metrics = useMemo(() => {
    const context = messages.reduce((sum, m) => sum + m.content.length, 0) + input.length
    return { events: messages.length, context: `${Math.round(context / 4)} / 8192`, speed: result?.tokensPerSecond ? `${result.tokensPerSecond.toFixed(1)} tok/s` : '—' }
  }, [messages, input, result])

  return (
    <div className="chat-layout">
      <aside className="chat-col sessions-panel chat-panel">
        <div className="sessions-head">
          <span className="sessions-title">会话</span>
          <button className="btn ghost icon sm" onClick={() => void createSession()} aria-label="新建会话"><MessageSquarePlus /></button>
        </div>
        <div className="session-list">
          {sessions.map(session => (
            <div key={session.id} className={`session-item ${session.id === activeId ? 'active' : ''}`} onClick={() => openSession(session)}>
              <div className="session-name">{session.title || '未命名会话'}</div>
              <div className="session-preview">{session.turns[session.turns.length - 1]?.content || '暂无消息'}</div>
            </div>
          ))}
          {!loading && sessions.length === 0 && <div className="note" style={{ padding: 10 }}>暂无会话，点击右上角新建会话。</div>}
        </div>
        {active && <button className="btn ghost sm" style={{ marginTop: 8, color: 'var(--text-3)' }} onClick={() => void deleteSession(active.id)}><Trash2 />删除会话</button>}
      </aside>

      <section className="chat-col chat-center">
        <div className="chat-head">
          <div className="chat-head-copy">
            <div className="chat-title">{active?.title || '新会话'}</div>
            <div className="chat-sub"><i className="status-dot" />{models?.backendDetail || '正在探测本机后端…'}<span>·</span><span>上下文 8192</span></div>
          </div>
          {sending && <button className="btn" onClick={stop}><CircleStop />停止</button>}
        </div>

        <div className="messages">
          {messages.length === 0 && !streamText ? (
            <div className="empty-chat">
              <div className="empty-chat-inner">
                <div className="empty-orb"><Sparkles /></div>
                <div className="empty-title">{hasModels ? '描述任务，由本机模型完成' : '尚未配置可用模型'}</div>
                <p className="empty-copy">
                  {hasModels
                    ? '对话仅通过本机 Ollama、Edge0 或内置 llama.cpp 运行，内容不会离开设备。选择模型后描述任务，生成过程中可随时停止。'
                    : '暂无可用模型。请先下载 GGUF 模型，或启动本机 Ollama；模型就绪后即可开始对话。'}
                </p>
                {hasModels ? (
                  <div className="empty-starters">
                    <span className="empty-starters-label">示例问题</span>
                    <div className="empty-starter-row">
                      {starters.map(text => (
                        <button key={text} type="button" onClick={() => setInput(text)}>{text}</button>
                      ))}
                    </div>
                  </div>
                ) : !loading ? (
                  <div className="empty-chat-cta">
                    <button className="btn primary sm" onClick={onOpenLibrary}><Boxes />前往模型库选择模型</button>
                    <span>已安装 Ollama？启动后返回本页，将自动识别可用模型。</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div key={index} className={`message ${message.role}`}>
                  {message.role === 'assistant' ? (
                    <div className="msg-body assistant"><span className="msg-avatar">星</span>{message.content}</div>
                  ) : <div className="bubble-user">{message.content}</div>}
                  {message.thinking && <div className="thinking">{message.thinking}</div>}
                  <div className={`msg-meta ${message.role}`}>{message.role === 'assistant' ? '天枢' : timeLabel(new Date().toISOString())}</div>
                </div>
              ))}
              {streamText && (
                <div className="message assistant">
                  <div className="msg-body assistant"><span className="msg-avatar">星</span>{streamText}<span className="caret" /></div>
                  <div className="msg-meta">正在生成…</div>
                </div>
              )}
            </>
          )}
          {error && <div className="empty-state" style={{ padding: '11px 14px', color: 'var(--danger)', background: 'var(--danger-soft)', textAlign: 'left' }}>{error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="composer" data-tour="chat-composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder={hasModels ? '输入消息，或描述你要完成的任务…' : '暂无可用模型，请先在模型库下载…'}
            aria-label="消息输入"
          />
          <div className="composer-foot">
            <span className="composer-chip"><Cpu />本地推理</span>
            <select className="composer-chip" data-tour="chat-model" value={model} onChange={e => setModel(e.target.value)} aria-label="选择模型" style={{ border: 0, outline: 0 }}>
              {models?.models.length ? models.models.map(name => <option key={name} value={name}>{name}</option>) : <option value="">未检测到可用模型</option>}
            </select>
            <span className="composer-chip" title="文件读写等工具能力将在后续版本开放"><Wrench />工具未开放</span>
            <span className="grow" />
            <span className="note">{input.length} / 8192</span>
            <button className="send-btn" disabled={!canSend} onClick={() => void send()} aria-label="发送"><ArrowUp /></button>
          </div>
        </div>
      </section>

      <aside className="chat-col inspector">
        <section className="inspector-card">
          <div className="inspector-title">当前会话 <span className="chip accent">实时</span></div>
          <div className="metric-grid">
            <div className="metric"><div className="metric-label">消息</div><div className="metric-value">{metrics.events}</div></div>
            <div className="metric"><div className="metric-label">上下文</div><div className="metric-value" style={{ fontSize: 13 }}>{metrics.context}</div></div>
            <div className="metric"><div className="metric-label">生成速度</div><div className="metric-value" style={{ fontSize: 14 }}>{metrics.speed}</div></div>
            <div className="metric"><div className="metric-label">检查点</div><div className="metric-value">0</div></div>
          </div>
          <div className="divider" />
          <div className="route-line">{models?.backend || '正在探测本机后端…'}</div>
          <div className="route-detail">{models?.backendDetail || '优先复用本机 Ollama；其次连接本机 Edge0；均不可用时回退至内置 llama.cpp。'}</div>
        </section>
        <section className="inspector-card">
          <div className="inspector-title">当前模型</div>
          <div className="route-line" style={{ overflowWrap: 'anywhere' }}>{model || '未选择'}</div>
          <div className="route-detail">上下文 8192 · 仅在本机运行 · 不调用云端 API</div>
        </section>
        <section className="inspector-card">
          <div className="inspector-title">工具能力</div>
          <div className="route-detail" style={{ lineHeight: 1.7 }}>文件读写、命令白名单、检查点与审计日志将在后续版本接入；当前版本仅提供模型管理与对话能力，工具能力尚未开放。</div>
        </section>
      </aside>
    </div>
  )
}
