import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowUp, Bot, Boxes, CircleStop, Cpu, Loader2, MessageSquarePlus, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { agentApi, api, streamAgent, streamChat } from '../api'
import type { AgentConfirm, AgentEvent, AgentMemoryInfo, AgentWindowInfo, AgentTodoItem, AgentToolItem, ChatModels, ChatResult, StoredSession, StoredTurn } from '../types'

interface UiMessage { role: 'user' | 'assistant'; content: string; thinking?: string; meta?: string }

const starters = [
  '帮我把工作目录里的文件整理成一份清单',
  '看看工作目录里有什么，再写一份 README',
  '读一下 notes.md，把待办事项补全',
]

function toUi(turns: StoredTurn[]): UiMessage[] {
  return turns.filter(t => t.role === 1 || t.role === 2).map(t => ({ role: t.role === 1 ? 'user' : 'assistant', content: t.content, thinking: t.thinking }))
}
function timeLabel(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const statusText: Record<AgentToolItem['status'], string> = {
  confirm: '等你确认',
  run: '执行中',
  ok: '已完成',
  fail: '失败',
  denied: '已拒绝',
}

const statusColor: Record<AgentToolItem['status'], string> = {
  confirm: 'var(--warning, #b26a00)',
  run: 'var(--accent)',
  ok: 'var(--accent)',
  fail: 'var(--danger)',
  denied: 'var(--text-3)',
}

const todoMark: Record<AgentTodoItem['status'], string> = { pending: '○', in_progress: '◐', completed: '●' }

const memoryRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }
const memoryScopeStyle: CSSProperties = { flex: 'none', fontSize: 11, color: 'var(--text-3)', paddingTop: 1 }

function memoryTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  // 后端这次实际留给历史的 token 预算：以前界面写死 8192，后端窗口小的时候显示的数会比真正能用的大。
  const [contextBudget, setContextBudget] = useState(8192)
  const [loading, setLoading] = useState(true)
  const [agentMode, setAgentMode] = useState(false)
  const [profile, setProfile] = useState<string>(() => {
    try { return localStorage.getItem('tianshu.agentProfile') || 'code' } catch { return 'code' }
  })
  const [planOnly, setPlanOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('tianshu.agentPlanOnly') === '1' } catch { return false }
  })
  const [timeline, setTimeline] = useState<AgentToolItem[]>([])
  const [todo, setTodo] = useState<AgentTodoItem[]>([])
  const [confirm, setConfirm] = useState<AgentConfirm | null>(null)
  const [runId, setRunId] = useState('')
  const [stopNote, setStopNote] = useState('')
  const [memory, setMemory] = useState<AgentMemoryInfo | null>(null)
  // 这次执行的窗口安排：开跑时先给「要了多少」，结束时补上后端实际给了多少。
  const [windowInfo, setWindowInfo] = useState<AgentWindowInfo | null>(null)
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, streamText, timeline])

  // 记忆卡片：打开任务模式时读一次，每次执行结束再读一次，让用户看到代理到底记了什么。
  useEffect(() => { if (agentMode) void loadMemory() }, [agentMode])

  async function loadMemory() {
    try { setMemory(await agentApi.memory()) } catch { /* 读不到不影响任务执行 */ }
  }

  async function forgetNote(scope: 'workspace' | 'global', text: string) {
    try { await agentApi.forgetNote(scope, text); await loadMemory() } catch (e) { toast(e instanceof Error ? e.message : '没有删掉') }
  }

  async function forgetSessionMemory(key: string) {
    try { await agentApi.forgetSession(key); await loadMemory() } catch (e) { toast(e instanceof Error ? e.message : '没有删掉') }
  }

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
      setTimeline([])
      setTodo([])
    } catch (e) { toast(e instanceof Error ? e.message : '新建会话失败') }
  }

  function openSession(session: StoredSession) {
    if (sending) return
    setActiveId(session.id)
    setMessages(toUi(session.turns))
    setResult(null)
    setError('')
    setStreamText('')
    setTimeline([])
    setTodo([])
    setStopNote('')
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

  function upsertTool(item: AgentToolItem) {
    setTimeline(prev => {
      const index = prev.findIndex(t => t.id === item.id)
      if (index < 0) return [...prev, item]
      const next = prev.slice()
      const merged = { ...prev[index], ...item }
      // 结果帧只补状态与耗时，不要把参数显示冲掉。
      if (!item.detail) merged.detail = prev[index].detail
      if (!item.round) merged.round = prev[index].round
      next[index] = merged
      return next
    })
  }

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'run':
        setRunId(event.runId)
        setTimeline([])
        setTodo([])
        setStopNote('')
        setWindowInfo(event.window ?? null)
        break
      case 'text':
        setStreamText(prev => prev + event.text)
        break
      case 'tool':
        upsertTool({
          id: event.id,
          name: event.name,
          target: event.target,
          status: event.status,
          detail: event.detail,
          ms: event.ms,
          round: event.round,
        })
        break
      case 'todo':
        setTodo(event.items || [])
        break
      case 'confirm':
        setConfirm(event)
        break
      case 'done': {
        // 「记住：」不经过模型，直接落成备忘；每次执行结束都重新读一次记忆，让用户看到记了什么。
        void loadMemory()
        // 结束时后端已经跑起来，把它实际给的窗口补上；开跑时只知道要了多少。
        if (event.window) setWindowInfo(event.window)
        const finalText = event.text || ''
        if (finalText) setMessages(prev => [...prev, { role: 'assistant', content: finalText }])
        setStreamText('')
        setTodo(event.todo || [])
        if (event.stop !== 'finished' && event.stop !== 'completed') {
          const note = event.error || `这次执行停在「${event.stop}」`
          setStopNote(note)
          if (event.stop === 'error') setError(note)
        }
        break
      }
      case 'error':
        setError(event.text || '执行失败')
        break
      default:
        break
    }
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
    setStopNote('')
    setTimeline([])
    setTodo([])
    setMessages(prev => [...prev, { role: 'user', content }])
    const controller = new AbortController()
    abortRef.current = controller
    let assembled = ''
    try {
      if (agentMode) {
        await streamAgent({ sessionId, model, content, profile, planOnly }, event => {
          if (event.type === 'text') assembled += event.text
          handleAgentEvent(event)
        }, controller.signal)
      } else {
        await streamChat({ sessionId, model, content }, chunk => {
          if (chunk.type === 'delta' && chunk.text) {
            assembled += chunk.text
            setStreamText(assembled)
          } else if (chunk.type === 'done' && chunk.result) {
            const final = chunk.result
            const finalText = final.text || assembled
            if (typeof final.contextBudget === 'number' && final.contextBudget > 0) setContextBudget(final.contextBudget)
            setResult(final)
            setMessages(prev => [...prev, { role: 'assistant', content: finalText, thinking: final.thinking }])
            setStreamText('')
            if (final.error) setError(final.error)
          } else if (chunk.type === 'error') {
            setError(chunk.text || '生成失败')
          }
        }, controller.signal)
      }
      void refreshSessions(sessionId)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSending(false)
      abortRef.current = null
      setConfirm(null)
    }
  }

  async function decide(allow: boolean, scope: 'once' | 'session') {
    const pending = confirm
    if (!pending) return
    setConfirm(null)
    try {
      await agentApi.decide(pending.runId, pending.callId, allow, scope)
    } catch (e) {
      setError(e instanceof Error ? e.message : '这次确认没送到内核')
    }
  }

  function stop() {
    if (agentMode && runId) { void agentApi.cancel(runId).catch(() => undefined) }
    abortRef.current?.abort()
  }

  const metrics = useMemo(() => {
    const context = messages.reduce((sum, m) => sum + m.content.length, 0) + input.length
    const done = todo.filter(t => t.status === 'completed').length
    return {
      events: messages.length,
      context: `${Math.round(context / 4)} / ${contextBudget}`,
      speed: result?.tokensPerSecond ? `${result.tokensPerSecond.toFixed(1)} tok/s` : '—',
      tools: timeline.length,
      todo: todo.length ? `${done}/${todo.length}` : '—',
    }
  }, [messages, input, result, timeline, todo])

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
            <div className="chat-sub"><i className="status-dot" />{models?.backendDetail || '正在探测本机后端…'}<span>·</span><span>{agentMode ? (profile === 'office' ? '办公模式' : '编程模式') + (planOnly ? ' · 只读计划' : '') : '对话模式'}</span></div>
          </div>
          {sending && <button className="btn" onClick={stop}><CircleStop />停止</button>}
        </div>

        <div className="messages">
          {messages.length === 0 && !streamText && timeline.length === 0 ? (
            <div className="empty-chat">
              <div className="empty-chat-inner">
                <div className="empty-orb"><Sparkles /></div>
                <div className="empty-title">{hasModels ? (agentMode ? '描述任务，由本机模型分步完成' : '描述任务，由本机模型完成') : '尚未配置可用模型'}</div>
                <p className="empty-copy">
                  {hasModels
                    ? (agentMode
                      ? (profile === 'office'
                        ? '办公形态只读写工作目录里的文件，不执行任何命令，适合整理文档、表格与批量改名。写文件与改文件每次都问你。'
                        : '编程形态会读写工作目录里的文件、按白名单执行命令。读操作直接放行；写文件、改文件与执行命令每次都问你。编译与测试可以放后台跑，期间继续做别的。')
                      : '对话仅通过本机 Ollama、Edge0 或内置 llama.cpp 运行，内容不会离开设备。')
                    : '暂无可用模型。请先下载 GGUF 模型，或启动本机 Ollama；模型就绪后即可开始对话。'}
                </p>
                {hasModels ? (
                  <div className="empty-starters">
                    <span className="empty-starters-label">示例任务</span>
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

              {timeline.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0 8px' }}>
                  {timeline.map(item => (
                    <details key={item.id} style={{
                      border: '1px solid var(--line, rgba(0,0,0,.08))', borderRadius: 10,
                      padding: '7px 10px', background: 'var(--surface-2, rgba(0,0,0,.02))',
                    }}>
                      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', listStyle: 'none' }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: statusColor[item.status], flex: 'none' }} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.target}</span>
                        {typeof item.ms === 'number' && item.ms > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.ms} ms</span>}
                        <span style={{ fontSize: 11, color: statusColor[item.status] }}>{statusText[item.status]}</span>
                      </summary>
                      {item.detail && (
                        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: '6px 0 0', color: 'var(--text-2)' }}>{item.detail}</pre>
                      )}
                      {typeof item.round === 'number' && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>第 {item.round} 轮</div>
                      )}
                    </details>
                  ))}
                </div>
              )}

              {streamText && (
                <div className="message assistant">
                  <div className="msg-body assistant"><span className="msg-avatar">星</span>{streamText}<span className="caret" /></div>
                  <div className="msg-meta">{sending ? '正在生成…' : '天枢'}</div>
                </div>
              )}
            </>
          )}
          {stopNote && <div className="empty-state" style={{ padding: '9px 12px', color: 'var(--text-2)', background: 'var(--surface-2, rgba(0,0,0,.03))', textAlign: 'left' }}>{stopNote}</div>}
          {error && <div className="empty-state" style={{ padding: '11px 14px', color: 'var(--danger)', background: 'var(--danger-soft)', textAlign: 'left' }}>{error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="composer" data-tour="chat-composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder={hasModels ? (agentMode ? (planOnly ? '描述任务，先看再给计划（这一步不会改文件）' : (profile === 'office' ? '描述任务，例如：把工作目录里的笔记整理成一份周报' : '描述任务，例如：读一下工作目录，写一份 README')) : '输入消息，或打开任务模式让模型动手…') : '暂无可用模型，请先在模型库下载…'}
            aria-label="消息输入"
          />
          <div className="composer-foot">
            <span className="composer-chip"><Cpu />本地推理</span>
            <select className="composer-chip" data-tour="chat-model" value={model} onChange={e => setModel(e.target.value)} aria-label="选择模型" style={{ border: 0, outline: 0 }}>
              {models?.models.length ? models.models.map(name => <option key={name} value={name}>{name}</option>) : <option value="">未检测到可用模型</option>}
            </select>
            <button
              type="button"
              className={`composer-chip ${agentMode ? 'accent' : ''}`}
              onClick={() => { if (!sending) { setAgentMode(v => !v); setTimeline([]); setTodo([]) } }}
              title={agentMode ? '关闭任务模式' : '打开任务模式：可读写工作目录、按白名单执行命令'}
              style={{ border: agentMode ? '1px solid var(--accent)' : '1px solid transparent', color: agentMode ? 'var(--accent)' : undefined }}
            >
              <Wrench />{agentMode ? '任务模式' : '任务模式关'}
            </button>
            {agentMode && (
              <div className="seg" role="tablist" aria-label="代理形态">
                {[{ id: 'office', label: '办公' }, { id: 'code', label: '编程' }].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={profile === item.id}
                    className={profile === item.id ? 'on' : ''}
                    disabled={sending}
                    onClick={() => {
                      setProfile(item.id)
                      try { localStorage.setItem('tianshu.agentProfile', item.id) } catch { /* 忽略存储失败 */ }
                    }}
                  >{item.label}</button>
                ))}
              </div>
            )}
            {agentMode && (
              <button
                type="button"
                className={planOnly ? 'plan-chip on' : 'plan-chip'}
                aria-pressed={planOnly}
                disabled={sending}
                title="只读计划：只查目录和文件，写盘与执行命令都会被拒绝，最后给一份改动计划"
                onClick={() => {
                  const next = !planOnly
                  setPlanOnly(next)
                  try { localStorage.setItem('tianshu.agentPlanOnly', next ? '1' : '0') } catch { /* 忽略存储失败 */ }
                }}
              >只读计划</button>
            )}
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
            <div className="metric"><div className="metric-label">工具调用</div><div className="metric-value" style={{ fontSize: 14 }}>{metrics.tools}</div></div>
            <div className="metric"><div className="metric-label">待办</div><div className="metric-value" style={{ fontSize: 14 }}>{metrics.todo}</div></div>
          </div>
          <div className="divider" />
          <div className="route-line">{models?.backend || '正在探测本机后端…'}</div>
          <div className="route-detail">{models?.backendDetail || '优先复用本机 Ollama；其次连接本机 Edge0；均不可用时回退至内置 llama.cpp。'}</div>
        </section>

        <section className="inspector-card">
          <div className="inspector-title">任务待办</div>
          {todo.length === 0
            ? <div className="route-detail">打开任务模式后，模型会先把要做的事列在这里，每完成一步更新状态。</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {todo.map(item => (
                  <div key={item.index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
                    <span style={{ color: item.status === 'completed' ? 'var(--accent)' : 'var(--text-3)', flex: 'none' }}>{todoMark[item.status]}</span>
                    <span style={{ color: item.status === 'completed' ? 'var(--text-3)' : 'var(--text-1)', textDecoration: item.status === 'completed' ? 'line-through' : 'none' }}>{item.content}</span>
                  </div>
                ))}
              </div>
            )}
        </section>

        {agentMode && (
          <section className="inspector-card">
            <div className="inspector-title">记忆</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div className="route-detail" style={{ marginBottom: 6 }}>你让我记住的</div>
                {(memory?.notes.workspace.length || 0) + (memory?.notes.global.length || 0) === 0
                  ? <div className="route-detail">还没有。以「记住：……」开头发一句就会长期记住，对所有会话生效；写「记住：所有项目：……」则对每个工作目录生效。</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {memory!.notes.workspace.map((text, index) => (
                        <div key={`w-${index}`} style={memoryRowStyle}>
                          <span style={memoryScopeStyle}>本目录</span>
                          <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{text}</span>
                          <button type="button" className="btn ghost icon sm" aria-label="忘掉这条" disabled={sending} onClick={() => void forgetNote('workspace', text)}><X /></button>
                        </div>
                      ))}
                      {memory!.notes.global.map((text, index) => (
                        <div key={`g-${index}`} style={memoryRowStyle}>
                          <span style={memoryScopeStyle}>所有项目</span>
                          <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{text}</span>
                          <button type="button" className="btn ghost icon sm" aria-label="忘掉这条" disabled={sending} onClick={() => void forgetNote('global', text)}><X /></button>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
              <div className="divider" />
              <div>
                <div className="route-detail" style={{ marginBottom: 6 }}>会话记忆</div>
                <div className="route-detail" style={{ marginBottom: 8 }}>一个会话一份、按工作目录隔开，只记程序核实过的进度：改过哪些文件、跑过哪些命令、哪些路没走通。模型自己写不了。</div>
                {!memory?.sessions.length
                  ? <div className="route-detail">还没有。做过一次任务之后，这里会出现它的记录。</div>
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {memory!.sessions.slice(0, 6).map(item => (
                        <details key={item.key} style={{ borderRadius: 8, background: 'var(--surface-2, rgba(0,0,0,.02))', padding: '6px 8px' }}>
                          <summary style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', listStyle: 'none', fontSize: 12.5 }}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.task}>{item.task || '（没有记下任务）'}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-3)', flex: 'none' }}>{memoryTime(item.updatedAt)}</span>
                            <button
                              type="button"
                              className="btn ghost icon sm"
                              aria-label="删掉这份会话记忆"
                              disabled={sending}
                              onClick={event => { event.preventDefault(); void forgetSessionMemory(item.key) }}
                            ><X /></button>
                          </summary>
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span>改动 {item.changed.length} 处{item.changed.length ? '：' + item.changed.map(line => line.split('@')[0]).join('、') : ''}</span>
                            <span>命令 {item.commands.length} 条{item.commands.length ? '：' + item.commands.join('；') : ''}</span>
                            {item.deadEnds.length > 0 && <span>没走通：{item.deadEnds.join('；')}</span>}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </section>
        )}

        <section className="inspector-card">
          <div className="inspector-title">当前模型</div>
          <div className="route-line" style={{ overflowWrap: 'anywhere' }}>{model || '未选择'}</div>
          <div className="route-detail">
            {windowInfo
              ? `窗口 ${windowInfo.actual ?? windowInfo.planned}${windowInfo.actual !== null && windowInfo.actual !== windowInfo.planned ? `（要的是 ${windowInfo.planned}）` : ''} · 对话预算 ${windowInfo.budget} · 单次回复上限 ${windowInfo.maxReply} · `
              : '上下文在开跑时按模型确定 · '}
            仅在本机运行 · 不调用云端 API
          </div>
          {windowInfo?.note && (
            <div className="route-detail" style={{ marginTop: 6, color: 'var(--warning, #b26a00)', lineHeight: 1.6 }}>{windowInfo.note}</div>
          )}
        </section>

        <section className="inspector-card">
          <div className="inspector-title">工具边界</div>
          <div className="route-detail" style={{ lineHeight: 1.7 }}>
            读写只限工作目录；读操作直接放行，写文件、改文件与执行命令逐次确认；命令只走随包白名单，不支持管道与拼接。编译与测试可以放后台跑，任务结束时还在跑的一律回收。
          </div>
        </section>
      </aside>

      {confirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 40,
        }}>
          <div style={{
            width: 'min(560px, 92vw)', background: 'var(--surface-1, #fff)', borderRadius: 14,
            padding: '18px 20px', boxShadow: '0 18px 48px rgba(0,0,0,.22)',
          }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>{confirm.title}</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5, margin: '0 0 14px', color: 'var(--text-2)', maxHeight: '38vh', overflow: 'auto' }}>{confirm.detail}</pre>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn ghost sm" onClick={() => void decide(false, 'once')}>拒绝</button>
              {confirm.kind !== 'execute' && (
                <button className="btn ghost sm" onClick={() => void decide(true, 'session')}>本会话都允许</button>
              )}
              <button className="btn primary sm" onClick={() => void decide(true, 'once')}>允许一次</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
