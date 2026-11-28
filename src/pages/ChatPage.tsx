import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Bot, Boxes, CircleStop, Cpu, FolderTree, Lock, Loader2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Power, Sparkles, Target, Trash2, Wrench, X } from 'lucide-react'
import { agentApi, api, streamAgent, streamChat } from '../api'
import { WorkspacePanel } from '../components/WorkspacePanel'
import type { AgentProfileId, AgentConfirm, GoalSnapshot, AgentEvent, AgentMemoryInfo, AgentWindowInfo, AgentTodoItem, AgentToolItem, ChatModels, ChatResult, StoredSession, StoredTurn } from '../types'

interface UiMessage { role: 'user' | 'assistant'; content: string; thinking?: string; meta?: string }

const starters = [
  '帮我把工作目录里的文件整理成一份清单',
  '看看工作目录里有什么，再写一份 README',
  '读一下 notes.md，把待办事项补全',
]

function subStatusLabel(status: string) {
  return status === 'running' ? '进行中'
    : status === 'completed' ? '完成'
      : status === 'partial' ? '部分完成'
        : status === 'budget_exhausted' ? '轮次用完'
          : status === 'timeout' ? '时间用完'
            : status === 'cancelled' ? '被停止'
              : status === 'rejected' ? '被拒绝'
                : status === 'failed' ? '出错' : status
}

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
  confirm: 'var(--warn)',
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

export function ChatPage({ toast, agent, sendKey, chatFontSize, chatWrapLong, onOpenLibrary, onOpenModels }: {
  toast: (message: string) => void
  // 当前 agent 形态由标题栏左上角决定（4.0.0 阶段 0）；本页只消费它，不再自带开关。
  agent: AgentProfileId
  sendKey: 'enter' | 'ctrl-enter'
  chatFontSize: 'small' | 'standard' | 'large'
  chatWrapLong: boolean
  onOpenLibrary: () => void
  onOpenModels: () => void
}) {
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [models, setModels] = useState<ChatModels | null>(null)
  // 新会话在「同时驻了好几种」时才需要用户点一份；会话一旦绑上就不再听这个选择。
  const [chosenModel, setChosenModel] = useState('')
  const [loaded, setLoaded] = useState<string[]>([])
  const [runModel, setRunModel] = useState('')   // 本次执行真正用的那一份（run 帧给的）
  // 会话列折叠：与左栏一样只有展开/折叠两档，**没有拖拽调宽的边框**。
  const [sessionsCollapsed, setSessionsCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('stardock.sessionsCollapsed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('stardock.sessionsCollapsed', sessionsCollapsed ? '1' : '0') } catch { /* 忽略 */ }
  }, [sessionsCollapsed])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ChatResult | null>(null)
  // 后端这次实际留给历史的 token 预算：以前界面写死 8192，后端窗口小的时候显示的数会比真正能用的大。
  const [contextBudget, setContextBudget] = useState(8192)
  const [loading, setLoading] = useState(true)
  const [agentMode, setAgentMode] = useState(false)
  // 形态就是左上角选中的那个 agent；这里留一个同名局部量，是为了不改下面几十处引用。
  const profile = agent
  const [planOnly, setPlanOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('tianshu.agentPlanOnly') === '1' } catch { return false }
  })
  const [timeline, setTimeline] = useState<AgentToolItem[]>([])
  const [todo, setTodo] = useState<AgentTodoItem[]>([])
  const [confirm, setConfirm] = useState<AgentConfirm | null>(null)
  const [runId, setRunId] = useState('')
  const [stopNote, setStopNote] = useState('')
  // 刚刚被用户批准的那份计划（文件路径）。不为空时输入框上多一个「按计划执行」：
  // 交计划与动手是两步，第二步得由用户发起，否则计划态与执行态的边界又没了。
  const [approvedPlan, setApprovedPlan] = useState('')
  const [memory, setMemory] = useState<AgentMemoryInfo | null>(null)
  // 长时程目标（4.0.0 阶段 3）：状态、预算与验收清单都在内核算，界面只呈现与发起动作。
  // 子任务卡：started 时进列表，ended 时更新状态与耗时（子体的中间过程不进时间线，避免刷屏）
  const [subtasks, setSubtasks] = useState<{ taskId: string; label: string; status: string; detail: string; ms: number; ok: boolean; phase: string }[]>([])
  // 右栏两个视图：概览 / 工作区。选择记在本地，用户在哪里看过文件就停在哪里。
  const [rightView, setRightView] = useState<'overview' | 'workspace'>(() => {
    try { return localStorage.getItem('stardock.rightView') === 'workspace' ? 'workspace' : 'overview' } catch { return 'overview' }
  })
  // 右栏可拖宽、可折成图标条：把「面板挤掉编辑区」这种抱怨挡在前面（各家被骂最多的就是不能调宽）
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const raw = Number(localStorage.getItem('stardock.inspectorWidth') ?? 0)
      return raw >= 300 && raw <= 760 ? raw : 340
    } catch { return 340 }
  })
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('stardock.inspectorOpen') !== '0' } catch { return true }
  })
  // 窄窗（最小 980）放不下右栏时改成抽屉：覆盖在对话区上方，不挤栅格，也不再把入口禁用。
  // drawerOpen 本身不持久化——窗口回到宽屏时它会自动并回右栏。
  const [drawerOpen, setDrawerOpen] = useState(false)
  const draggingRef = useRef(false)

  function persistInspector(width: number, open: boolean) {
    try {
      localStorage.setItem('stardock.inspectorWidth', String(Math.round(width)))
      localStorage.setItem('stardock.inspectorOpen', open ? '1' : '0')
    } catch { /* 隐私模式忽略 */ }
  }
  const [goal, setGoal] = useState<GoalSnapshot | null>(null)
  const [goalSuspended, setGoalSuspended] = useState(false)   // 这一轮是计划态，目标没被加载
  const [goalDraft, setGoalDraft] = useState('')
  const [goalAcceptance, setGoalAcceptance] = useState('')
  const [goalTurns, setGoalTurns] = useState(10)
  const [goalMinutes, setGoalMinutes] = useState(25)
  const [goalOpen, setGoalOpen] = useState(false)
  const [evidence, setEvidence] = useState<string[]>([])
  const [goalError, setGoalError] = useState('')
  // 这次执行的窗口安排：开跑时先给「要了多少」，结束时补上后端实际给了多少。
  const [windowInfo, setWindowInfo] = useState<AgentWindowInfo | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const active = sessions.find(s => s.id === activeId) || null
  // 三态分开：把"还没问到"渲染成"没有模型"，sidecar 慢一点用户就会看到"你去下载"，
  // 而机器上其实装着模型——这是真浏览器里抓到的（第 16 轮）。
  const modelsLoading = models === null
  const hasInstalled = Boolean(models && models.models.length > 0)
  const hasModels = hasInstalled
  // 会话绑的那一份优先；没绑过时，只驻了一份就直接用它，驻了好几份才让用户选。
  const boundModel = active?.model ?? ''
  // 空态文案的优先级：加载中 > 装着但没驻留 > 有得用 > 真没有。
  // "装着但没驻留"必须排在"有得用"前面——4.0 起会话只能用启动的那一份，
  // 此时说"描述任务即可由本机模型完成"是骗人的（真浏览器里就是这么显示的，第 16 轮抓到）。
  const nothingResident = hasInstalled && loaded.length === 0 && boundModel.length === 0
  const emptyHeadline = modelsLoading
    ? '正在确认本机有哪些模型'
    : nothingResident
      ? '先启动一份模型'
      : hasModels
        ? (agentMode ? '描述任务，由本机模型分步完成' : '描述任务，由本机模型完成')
        : '尚未配置可用模型'
  const emptyCopy = modelsLoading
    ? '正在读后端与本机模型清单，稍等；这一步不会改动任何东西。'
    : nothingResident
      ? '本机装着模型但一份都还没驻留。会话只能用"启动的那一份"：去「我的模型」启动它，再回来发消息；要换别的模型，先关掉当前这份再新建会话。'
      : hasModels
        ? (agentMode
          ? (profile === 'office'
            ? '办公形态只读写工作目录里的文件，不执行任何命令，适合整理文档、表格与批量改名。写文件与改文件每次都问你。'
            : '编程形态会读写工作目录里的文件、按白名单执行命令。读操作直接放行；写文件、改文件与执行命令每次都问你。编译与测试可以放后台跑，期间继续做别的。')
          : '对话仅通过本机 Ollama、Edge0 或内置 llama.cpp 运行，内容不会离开设备。')
        : '暂无可用模型。请先下载 GGUF 模型，或启动本机 Ollama；模型就绪后即可开始对话。'
  const effectiveModel = boundModel || chosenModel || (loaded.length === 1 ? loaded[0] : '')
  const needChoice = boundModel.length === 0 && chosenModel.length === 0 && loaded.length > 1
  // 筹码过去只有一句兜底：`boundModel || (loaded.length === 1 ? loaded[0] : '未启动模型·去启动')`。
  // 于是"还没问到清单""一份都没驻留""驻了两份该选哪份"三种情况都显示同一句"未启动模型·去启动"，
  // 而驻了多份时那句直接是错的；开跑一瞬间 loaded 还没刷回来，也会闪一下这句话（真浏览器里看到）。
  const chipLabel = boundModel || (loaded.length === 1 ? loaded[0]
    : loaded.length > 1 ? loaded[0] + ' 等 ' + loaded.length + ' 份在跑'
    : runModel || (models === null ? '正在确认已启动的模型…' : '未启动模型·去启动'))
  // 能不能发不看「装了」，看「绑了或在跑」：装了但没启动的模型发不出去，这是 4.0 的规矩。
  const canSend = input.trim().length > 0 && !sending && (boundModel.length > 0 || loaded.length > 0)

  useEffect(() => {
    let alive = true
    async function boot() {
      try {
        const [list, chatModels] = await Promise.all([api.sessions(agent), api.chatModels()])
        if (!alive) return
        setSessions(list.sessions)
        setModels(chatModels)
        setLoaded(chatModels.loaded ?? [])
        if (chatModels.busy) toast(`内核正在${chatModels.busy}，完成后刷新就会看到运行态`)
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

  // 换 agent = 换一个执行者：会话列表整个换作用域，不能把上一个 agent 的会话留在眼前。
  // 正在跑的这一次不硬掐——发送按钮在 sending 时本就禁用，跑完这一轮再切视野。
  useEffect(() => {
    if (loading) return
    void refreshSessions('')
    setApprovedPlan('')
  }, [agent])

  async function loadMemory() {
    try { setMemory(await agentApi.memory()) } catch { /* 读不到不影响任务执行 */ }
  }

  async function forgetNote(scope: 'workspace' | 'global', text: string) {
    try { await agentApi.forgetNote(scope, text); await loadMemory() } catch (e) { toast(e instanceof Error ? e.message : '没有删掉') }
  }

  async function forgetSessionMemory(key: string) {
    try { await agentApi.forgetSession(key); await loadMemory() } catch (e) { toast(e instanceof Error ? e.message : '没有删掉') }
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    // 右栏宽度按指针到窗口右边的距离算，最小 300 最大 760：再窄就看不清 diff，再宽会挤掉对话
    const next = Math.min(760, Math.max(300, window.innerWidth - event.clientX))
    setInspectorWidth(next)
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    persistInspector(inspectorWidth, inspectorOpen)
  }

  function changeRightView(next: 'overview' | 'workspace') {
    setRightView(next)
    try { localStorage.setItem('stardock.rightView', next) } catch { /* 隐私模式忽略 */ }
  }

  async function loadGoal(sessionId: string) {
    if (!sessionId) { setGoal(null); return }
    try { setGoal((await agentApi.goal(sessionId)).goal) } catch { /* 读不到就当没有目标，不打断对话 */ }
  }

  async function applyGoal(action: 'declare' | 'pause' | 'resume' | 'complete' | 'clear', extra: Record<string, unknown> = {}) {
    if (!activeId) { setGoalError('先建一个会话，再声明目标。'); return }
    setGoalError('')
    try {
      const result = await agentApi.setGoal({
        sessionId: activeId,
        action,
        profile: agent,
        ...(action === 'declare' ? {
          objective: goalDraft.trim(),
          acceptance: goalAcceptance.split('\n').map(line => line.trim()).filter(Boolean),
          turnBudget: goalTurns,
          wallClockMinutes: goalMinutes,
        } : {}),
        ...extra,
      })
      setGoal(result.goal)
      if (!result.ok) { setGoalError(result.error); return }
      if (action === 'declare') { setGoalOpen(false); setGoalDraft(''); setGoalAcceptance('') }
      if (action === 'complete' || action === 'clear') setEvidence([])
      toast(action === 'declare' ? '目标已设定，我会按它推进并记下预算'
        : action === 'pause' ? '目标已暂停：接下来不会再改动工作区'
          : action === 'resume' ? '已恢复推进（这一次授权由你点下）'
            : action === 'complete' ? '目标已标记完成' : '目标已清除')
    } catch (e) {
      setGoalError(e instanceof Error ? e.message : '目标操作失败')
    }
  }

  async function refreshSessions(prefer = activeId) {
    try {
      const list = await api.sessions(agent)
      setSessions(list.sessions)
      const pick = prefer && list.sessions.some(s => s.id === prefer) ? prefer : (list.sessions[0]?.id ?? '')
      setActiveId(pick)
      void loadGoal(pick)
      const found = list.sessions.find(s => s.id === pick)
      setMessages(found ? toUi(found.turns) : [])
      // 会话的第一条发出去之后才绑上模型，所以发完还要刷一次运行态；不刷状态条会停在「未启动」。
      try { setLoaded((await api.chatModels()).loaded ?? []) } catch { /* 刷不到就维持上一次读数，不拦发送 */ }
    } catch { /* list refresh is non-fatal */ }
  }

  async function createSession() {
    try {
      const session = await api.createSession('新会话', agent)
      setSessions(prev => [session, ...prev])
      setActiveId(session.id)
      setApprovedPlan('')
      void loadGoal(session.id)
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
    void loadGoal(session.id)
    setGoalError('')
    // 换会话就是把「这一份模型」与「刚批准的计划」都换一份：上一个会话的选择不能带过来。
    setChosenModel('')
    setApprovedPlan('')
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
      case 'subtask':
        // 卡片以任务号为键：started 先进来占位，ended 再落成状态与耗时
        setSubtasks(prev => {
          const key = event.taskId || event.callId
          const found = prev.find(item => item.taskId === key)
          const row = {
            taskId: key,
            label: event.label || '子任务',
            status: event.phase === 'started' ? 'running' : event.status,
            detail: event.detail || '',
            ms: event.ms ?? (found?.ms ?? 0),
            ok: event.phase === 'started' ? true : Boolean(event.ok),
            phase: event.phase,
          }
          return found ? prev.map(item => item.taskId === key ? row : item) : [...prev, row]
        })
        break
      case 'goal':
        // 内核每变一次推一帧；快照仍从接口取，避免界面自己拼一套口径
        void loadGoal(activeId)
        break
      case 'run':
        if (event.goal !== undefined) setGoal(event.goal ?? null)
        setGoalSuspended(event.goalSuspended === true)
        setRunModel(event.boundModel || event.model || '')
        setRunId(event.runId)
        setTimeline([])
        setTodo([])
        setSubtasks([])
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
        // 挂起只描述这一轮：执行一结束就撤，留着就成了假信息
        setGoalSuspended(false)
        if (event.goal !== undefined) setGoal(event.goal ?? null)
        if (event.goalSaveError) setGoalError('目标状态没能写回磁盘：' + event.goalSaveError)
        // 「记住：」不经过模型，直接落成备忘；每次执行结束都重新读一次记忆，让用户看到记了什么。
        void loadMemory()
        // 结束时后端已经跑起来，把它实际给的窗口补上；开跑时只知道要了多少。
        if (event.window) setWindowInfo(event.window)
        setApprovedPlan(event.stop === 'plan-approved' ? (event.planPath || '') : '')
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

  async function send(forced?: { content: string; followPlan: boolean }) {
    const content = (forced?.content ?? input).trim()
    if (!content || sending) return
    const followPlan = forced?.followPlan ?? false
    let sessionId = activeId
    if (!sessionId) {
      try {
        const created = await api.createSession(content.slice(0, 24) || '新会话', agent)
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
    setSubtasks([])
    if (!followPlan) setApprovedPlan('')
    setMessages(prev => [...prev, { role: 'user', content }])
    const controller = new AbortController()
    abortRef.current = controller
    let assembled = ''
    try {
      if (agentMode) {
        await streamAgent({ sessionId, model: effectiveModel, content, profile, planOnly: followPlan ? false : planOnly, followPlan }, event => {
          if (event.type === 'text') assembled += event.text
          handleAgentEvent(event)
        }, controller.signal)
      } else {
        await streamChat({ sessionId, model: effectiveModel, content }, chunk => {
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

  // 切页会把整个 ChatPage 卸载（App 里是 `page === 'chat' ? <ChatPage/> : …`）。
  // 原先卸载只把 alive 置 false，流与内核执行都还在跑：待应答的确认框随组件一起消失，
  // 内核干等 ConfirmTimeout（3 分钟）后**静默按拒绝处理**——用户看到的是"agent 自己没做"。
  // 第 19 轮真浏览器里连着三次撞上（审计三条 write_file decision=deny）。
  // 卸载时如实收摊：取消这次执行并中断流，让它变成"被停掉"而不是"没人应答"。
  const stopRef = useRef<() => void>(() => undefined)
  stopRef.current = stop
  const sendingRef = useRef(false)
  sendingRef.current = sending
  useEffect(() => () => {
    if (sendingRef.current) stopRef.current()
  }, [])

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

  // 窗口宽度是右栏能不能出现的唯一依据：以前靠一条 @media + !important 把内联栅格覆盖掉，
  // 结果折叠态的图标条（由 React 条件渲染）在窄窗根本不进 DOM，右栏既看不见也开不了。
  // 默认窗口只有 1280 宽，那条断点写的是 1380——等于开箱就砍掉了 4.0 的右栏功能。
  const [viewportW, setViewportW] = useState<number>(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const [chromeW, setChromeW] = useState(244)   // 左侧导航栏 + 页面左右留白：实测值，不是猜的
  useEffect(() => {
    const measure = () => {
      setViewportW(window.innerWidth)
      const rail = document.querySelector('.rail') as HTMLElement | null
      const shell = document.querySelector('.app-shell, .workspace') as HTMLElement | null
      const railW = rail ? rail.getBoundingClientRect().width : 72
      const pad = shell ? parseFloat(getComputedStyle(shell).paddingLeft || '0') + parseFloat(getComputedStyle(shell).paddingRight || '0') : 24
      // 导航栏是固定条，不随右栏变化，所以拿它算可用宽度不会有反馈回路
      setChromeW(Math.round(railW + pad))
    }
    measure()
    window.addEventListener('resize', measure)
    const timer = window.setTimeout(measure, 300)   // 首帧样式还没落定，补量一次
    return () => { window.removeEventListener('resize', measure); window.clearTimeout(timer) }
  }, [])
  // 左栏 220 + 对话至少 420 + 分隔条 10：剩下的才给右栏，最少 240 还能用
  // 可用宽度要减掉**左侧导航栏与页面留白**，不能拿窗口宽度直接算：
  // 第一版漏了这一笔（写成 viewportW - 220 - 420 - 10），于是最小宽度 980 下右栏照样占 340，
  // 对话中栏被挤到 110px 而它需要 142px——输入框和底部说明都被裁掉。
  // 这是把界面放到真实窗口尺寸（1280 / 980）下量出来的，窄页签看不出。
  const availableW = Math.max(0, viewportW - chromeW)
  const roomForInspector = availableW - 220 - 420 - 10
  const inspectorFits = roomForInspector >= 240
  // 放不下就用浮层；放得下就并回栅格里的固定右栏，两种形态共用同一份内容。
  const drawerMode = drawerOpen && !inspectorFits
  const effectiveInspectorWidth = Math.max(240, Math.min(inspectorWidth, Math.max(240, roomForInspector)))

  // 窗口变宽后抽屉自动并回右栏，避免它继续盖着对话区。
  useEffect(() => {
    if (inspectorFits) setDrawerOpen(false)
  }, [inspectorFits])

  // 抽屉是浮层：Esc 与点遮罩都能关；关的时候把「打开右栏」的偏好一起收回，
  // 否则下次窗口变宽右栏又会自己弹出来。
  useEffect(() => {
    if (!drawerMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawerOpen(false)
      setInspectorOpen(false)
      persistInspector(inspectorWidth, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerMode, inspectorWidth])

  function openInspector(view?: 'overview' | 'workspace') {
    if (view) changeRightView(view)
    setInspectorOpen(true)
    persistInspector(inspectorWidth, true)
    // 窄窗里没有第 4 列可占，改开浮层；宽窗直接展开固定右栏。
    if (!inspectorFits) setDrawerOpen(true)
  }

  function closeInspector() {
    setDrawerOpen(false)
    setInspectorOpen(false)
    persistInspector(inspectorWidth, false)
  }

  const layoutStyle = {
    gridTemplateColumns: (() => {
      const left = sessionsCollapsed ? '46px' : '220px'
      return (inspectorOpen && inspectorFits)
        ? `${left} minmax(0, 1fr) 10px ${effectiveInspectorWidth}px`
        : `${left} minmax(0, 1fr) 52px`
    })(),
    // 列数与命名区必须一起换：只写 3 列却留着 splitter/right 两个区，
    // 右栏会被放到隐式第 4 列，窄窗下只剩 40px（实测抽屉被压成 28px）。
    gridTemplateAreas: (inspectorOpen && inspectorFits)
      ? '"sessions chat splitter right"'
      : '"sessions chat right"',
  } as React.CSSProperties

  return (
    <div className={`chat-layout chat-font-${chatFontSize} ${chatWrapLong ? '' : 'chat-long-lines'}`} style={layoutStyle}>
      <aside className={`chat-col sessions-panel chat-panel ${sessionsCollapsed ? 'collapsed' : ''}`}>
        {sessionsCollapsed ? (
          <div className="sessions-collapsed">
            <button className="btn ghost icon sm" onClick={() => setSessionsCollapsed(false)}
              aria-expanded={false} aria-label="展开会话列表" title="展开会话列表"><PanelLeftOpen /></button>
            <button className="btn ghost icon sm" onClick={() => void createSession()} aria-label="新建会话" title="新建会话"><MessageSquarePlus /></button>
          </div>
        ) : (
        <div className="sessions-head">
          <span className="sessions-title">会话</span>
          <span className="sessions-head-actions">
            <button className="btn ghost icon sm" onClick={() => void createSession()} aria-label="新建会话" title="新建会话"><MessageSquarePlus /></button>
            <button className="btn ghost icon sm" onClick={() => setSessionsCollapsed(true)}
              aria-expanded={true} aria-label="收起会话列表" title="收起会话列表"><PanelLeftClose /></button>
          </span>
        </div>
        )}
        {!sessionsCollapsed && (
        <div className="session-list">
          {sessions.map(session => (
            <div key={session.id} className={`session-item ${session.id === activeId ? 'active' : ''}`} onClick={() => openSession(session)}>
              <div className="session-name">{session.title || '未命名会话'}</div>
              <div className="session-preview">{session.turns[session.turns.length - 1]?.content || '暂无消息'}</div>
            </div>
          ))}
          {!loading && sessions.length === 0 && <div className="note" style={{ padding: 10 }}>暂无会话，点击右上角新建会话。</div>}
        </div>
        )}
        {!sessionsCollapsed && active && <button className="btn ghost sm" style={{ marginTop: 8, color: 'var(--text-3)' }} onClick={() => void deleteSession(active.id)}><Trash2 />删除会话</button>}
      </aside>

      <section className="chat-col chat-center">
        <div className="chat-head">
          <div className="chat-head-copy">
            <div className="chat-title">{active?.title || '新会话'}</div>
            <div className="chat-sub"><i className="status-dot" />{models?.backendDetail || '正在探测本机后端…'}{models?.busy ? <span>· <Loader2 className="spin" style={{ width: 12, height: 12 }} /> {models.busy}</span> : null}</div>
          </div>
          {sending && <button className="btn" onClick={stop}><CircleStop />停止</button>}
        </div>

        <div className="messages">
          {messages.length === 0 && !streamText && timeline.length === 0 ? (
            <div className="empty-chat">
              <div className="empty-chat-inner">
                <div className="empty-orb"><Sparkles /></div>
                <div className="empty-title">{emptyHeadline}</div>
                <p className="empty-copy">{emptyCopy}</p>
                {hasModels && !modelsLoading ? (
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
                      padding: '7px 10px', background: 'var(--surface-soft)',
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
          {subtasks.length > 0 && (
            <div className="first-run-tip" style={{ marginBottom: 8 }}>
              <span className="first-run-icon" aria-hidden><Bot size={15} /></span>
              <div className="first-run-copy">
                <b>子任务 {subtasks.filter(item => item.status === 'running').length} 个在跑 / 共 {subtasks.length} 个 · 要单独停一个去右栏「工作区 → 任务」</b>
                {subtasks.map(item => (
                  <span key={item.taskId} style={{ display: 'block', marginTop: 3 }}>
                    {item.label} · {subStatusLabel(item.status)}{item.ms ? ` · ${(item.ms / 1000).toFixed(1)} 秒` : ''}
                    {item.detail ? ` · ${item.detail.slice(0, 80)}` : ''}
                  </span>
                ))}
                <span>子体只做只读的活（扫文件、查资料），结果以结构化报告交回；它说的话不代替你的批准。</span>
              </div>
            </div>
          )}

          {stopNote && <div className="empty-state" style={{ padding: '9px 12px', color: 'var(--text-2)', background: 'var(--surface-soft)', textAlign: 'left' }}>{stopNote}</div>}
          {error && <div className="empty-state" style={{ padding: '11px 14px', color: 'var(--danger)', background: 'var(--danger-soft)', textAlign: 'left' }}>{error}</div>}
          <div ref={bottomRef} />
        </div>

        <div className="status-strip" role="status" aria-label="本次执行的状态">
          <button type="button" className={`strip-chip ${agentMode ? 'accent' : ''}`} onClick={() => { if (!sending) { setAgentMode(v => !v); setTimeline([]); setTodo([]) } }} title={agentMode ? '关闭任务模式：这一句只是聊天' : '打开任务模式：由当前形态的 agent 分步执行'}>
            <Wrench />{agentMode ? '任务' : '纯对话'}
          </button>
          <span className="strip-chip" title={profile === 'office' ? '办公 agent：只读写工作区文件，不执行任何命令' : '编程 agent：读写文件并按白名单执行命令'}>
            {profile === 'office' ? '办公' : '编程'}
          </span>
          {boundModel.length === 0 && loaded.length > 1 ? (
            <select
              className="strip-chip"
              data-tour="chat-model"
              value={chosenModel}
              onChange={e => setChosenModel(e.target.value)}
              aria-label="从已启动的模型里选一份"
              title={`本机同时驻留了 ${loaded.length} 份模型，先指定这个会话用哪一份`}
            >
              <option value="">选择已启动的模型…</option>
              {loaded.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <button type="button" className={`strip-chip ${boundModel ? 'locked' : 'warn'}`} data-tour="chat-model" onClick={onOpenModels} title={boundModel ? `本会话绑定 ${boundModel}。换模型要去「我的模型」关掉当前这份再启动，旧会话不跟着换` : '模型要先启动才能发消息'}>
              <Lock />{chipLabel}
            </button>
          )}
          {agentMode && (
            <button type="button" className={`strip-chip ${planOnly ? 'plan' : approvedPlan ? 'accent' : ''}`} onClick={() => { if (!sending) { const next = !planOnly; setPlanOnly(next); try { localStorage.setItem('tianshu.agentPlanOnly', next ? '1' : '0') } catch { /* 忽略存储失败 */ } } }} title={planOnly ? '只读计划态：写盘与命令在执行器就被拒，只准写那一份计划文件' : '点击切到只读计划：先看再给计划，这一步不会改文件'}>
              {planOnly ? '只读计划 · 不会改文件' : approvedPlan ? '按已批准的计划' : '写入需确认'}
            </button>
          )}
          {goal && (
            <span className={`strip-chip ${goal.state === 'active' && !goalSuspended ? 'accent' : goal.state === 'blocked' || goalSuspended ? 'warn' : ''}`} title={goalSuspended ? '这一轮是只读计划：不消耗目标轮次与 token，也不自动续跑。计划批准后照常推进。' : goal.objective}>
              <Target />目标 {goal.turns.used}{goal.turns.limit ? `/${goal.turns.limit}` : ''} 轮{goalSuspended ? ' · 本轮不推进' : ''}
            </span>
          )}
          {subtasks.some(item => item.status === 'running') && (
            <span className="strip-chip accent" title="子任务在跑。推理是一次一份，多个子体排队是正常现象">
              <Bot />{subtasks.filter(item => item.status === 'running').length} 个子任务
            </span>
          )}
          <span className="grow" />
          <span className="strip-num" title="历史占用与后端这次给的真实预算">上下文 {metrics.context}</span>
        </div>

        {approvedPlan && (
          <div className="first-run-tip" style={{ marginBottom: 10 }}>
            <span className="first-run-icon" aria-hidden><Play size={15} /></span>
            <div className="first-run-copy">
              <b>计划已批准，存在 {approvedPlan}</b>
              <span>只读计划态到「交给用户批准」就停了，刚才那份计划没改过工作区一个字节。点「按计划执行」才会动手；也可以先把那个文件改了再点。</span>
            </div>
            <button
              className="btn primary sm"
              disabled={sending}
              onClick={() => void send({ content: `按 ${approvedPlan} 里已批准的计划动手`, followPlan: true })}
            >
              <Play />按计划执行
            </button>
          </div>
        )}

        <div className="composer" data-tour="chat-composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              const wantsSend = sendKey === 'ctrl-enter'
                ? (e.ctrlKey || e.metaKey)
                : !e.ctrlKey && !e.metaKey
              if (e.key === 'Enter' && !e.shiftKey && wantsSend) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={!hasModels ? '本机没有可用模型，请先去模型库下载…' : loaded.length === 0 && boundModel.length === 0 ? '先在「我的模型」启动一份模型，再回来发消息…' : (agentMode ? (planOnly ? '描述任务，先看再给计划（这一步不会改文件）' : (profile === 'office' ? '描述任务，例如：把工作目录里的笔记整理成一份周报' : '描述任务，例如：读一下工作目录，写一份 README')) : '输入消息，或打开任务模式让模型动手…')}
            aria-label="消息输入"
          />
          <div className="composer-foot">
            {/* 模式、模型、写权限这些"状态"已经收进输入框上方的状态条，这里只留真正的动作。
                之前同一个控制在三处重复（标题行、输入框下排、右栏），改一处忘另一处就会说谎。 */}
            <span className="composer-chip" title={agentMode ? '读写只限工作目录；这条线由执行器兜，不靠提示词' : '纯对话不动任何文件'}>
              <Cpu />本地推理 · {agentMode ? '动手只看工作目录' : '不改文件'}
            </span>
            <span className="grow" />
            <span className="note">{input.length} / 8192</span>
            <button className="send-btn" disabled={!canSend} onClick={() => void send()} aria-label="发送"><ArrowUp /></button>
          </div>
        </div>
      </section>

      {inspectorOpen && inspectorFits ? (
        <div
          className="chat-splitter"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整右栏宽度"
          title="拖动调整宽度；点右侧按钮可收起"
        />
      ) : null}

      {drawerMode && (
        <button className="inspector-scrim" aria-label="关闭右栏" onClick={closeInspector} />
      )}

      {(!inspectorOpen || !inspectorFits) ? (
        <aside className="chat-col inspector-rail">
          {/* 窄窗不再禁用入口：点开就是浮层。宽窗才是展开固定右栏。 */}
          <button className="btn ghost icon sm" title={inspectorFits ? '展开右栏' : '打开右栏浮层（窗口较窄）'} aria-label="展开右栏" aria-expanded={inspectorFits ? inspectorOpen : drawerMode} onClick={() => openInspector()}><PanelRightOpen /></button>
          <button className="btn ghost icon sm" title={inspectorFits ? '工作区' : '打开工作区浮层'} aria-label="打开工作区" onClick={() => openInspector('workspace')}><FolderTree /></button>
          <button className="btn ghost icon sm" title={inspectorFits ? '概览' : '打开概览浮层'} aria-label="打开概览" onClick={() => openInspector('overview')}><Bot /></button>
        </aside>
      ) : null}

      {((inspectorOpen && inspectorFits) || drawerMode) && (
      <aside
        className={`chat-col inspector${drawerMode ? ' inspector-drawer' : ''}`}
        role={drawerMode ? 'dialog' : undefined}
        aria-label="右侧工作区"
      >
        {/* 右栏顶部两个视图：概览（会话指标、记忆、目标、工具边界）与工作区（文件 / 预览 / 变更）。
            工作区只读：任何写回仍然只能走 agent 的写工具与确认。 */}
        <div className="ws-switch" role="tablist" aria-label="右栏视图">
          <button role="tab" aria-selected={rightView === 'overview'} className={rightView === 'overview' ? 'on' : ''} onClick={() => changeRightView('overview')}><Bot />概览</button>
          <button role="tab" aria-selected={rightView === 'workspace'} className={rightView === 'workspace' ? 'on' : ''} onClick={() => changeRightView('workspace')} data-tour="chat-workspace"><FolderTree />工作区</button>
          <span className="grow" />
          <button className="btn ghost icon sm" title="收起右栏" aria-label="收起右栏" onClick={closeInspector}><PanelRightClose /></button>
        </div>

        {rightView === 'workspace' && <WorkspacePanel active toast={toast} tasks={subtasks} goal={goal} />}

        <div hidden={rightView !== 'overview'}>
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
                    <span style={{ color: item.status === 'completed' ? 'var(--text-3)' : 'var(--text)', textDecoration: item.status === 'completed' ? 'line-through' : 'none' }}>{item.content}</span>
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
                        <details key={item.key} style={{ borderRadius: 8, background: 'var(--surface-soft)', padding: '6px 8px' }}>
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
          <div className="inspector-title">
            目标
            {goal && <span className={`chip ${goal.state === 'active' ? 'accent' : goal.state === 'complete' ? 'success' : goal.state === 'blocked' ? 'warn' : ''}`}>{goal.stateLabel}</span>}
            {!goal && <span className="chip">未设定</span>}
          </div>

          {!goal && !goalOpen && (
            <div className="route-detail" style={{ lineHeight: 1.7 }}>
              给一件要好几轮才能做完的事设一个目标：内核会按轮次、token、墙钟三笔预算记账，
              用尽就停下来等你，而不是假装做完。暂停后重启天枢不会自己接着跑。
              <div style={{ marginTop: 8 }}>
                <button className="btn ghost sm" disabled={sending} onClick={() => { setGoalOpen(true); setEvidence([]) }}><Target />设定目标</button>
              </div>
            </div>
          )}

          {!goal && goalOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={goalDraft}
                onChange={e => setGoalDraft(e.target.value)}
                placeholder="要达成什么，一句话，能验收。例如：把 notes/ 里的记录整理成一份周报"
                style={{ minHeight: 60 }}
                aria-label="目标"
              />
              <textarea
                value={goalAcceptance}
                onChange={e => setGoalAcceptance(e.target.value)}
                placeholder={'验收标准，一行一条（留空则完成只能由你确认）\n例如：周报文件存在\n覆盖最近七天'}
                style={{ minHeight: 56 }}
                aria-label="验收标准"
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--text-2)' }}>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>轮次
                  <input type="number" min={1} max={50} value={goalTurns} onChange={e => setGoalTurns(Number(e.target.value) || 10)} style={{ width: 56 }} />
                </label>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>分钟
                  <input type="number" min={1} max={240} value={goalMinutes} onChange={e => setGoalMinutes(Number(e.target.value) || 25)} style={{ width: 60 }} />
                </label>
                <span className="grow" />
                <button className="btn ghost sm" onClick={() => { setGoalOpen(false); setGoalDraft(''); setGoalAcceptance('') }}>取消</button>
                <button className="btn primary sm" disabled={!goalDraft.trim() || sending} onClick={() => void applyGoal('declare')}>设定</button>
              </div>
              <div className="route-detail">token 预算默认不设：多数本地后端不逐次回报用量，硬设一个数只会显示成「还剩很多」这种假话。</div>
            </div>
          )}

          {goal && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{goal.objective}</div>
              {goal.acceptance.length > 0 && (
                <div className="route-detail">
                  验收 {goal.acceptance.length} 条：{goal.acceptance.join('；')}
                </div>
              )}
              {goal.acceptance.length === 0 && (
                <div className="route-detail" style={{ color: 'var(--warn)' }}>没有验收标准：内核不会替你说「目标达成」，完成只能由你确认。</div>
              )}
              <div className="metric-grid">
                <div className="metric"><div className="metric-label">轮次</div><div className="metric-value">{goal.turns.used}{goal.turns.limit ? `/${goal.turns.limit}` : ''}</div></div>
                <div className="metric"><div className="metric-label">墙钟</div><div className="metric-value" style={{ fontSize: 15 }}>{goal.minutesUsed}{goal.wallClock.limit ? `/${goal.wallClock.limit} 分` : ' 分'}</div></div>
                <div className="metric"><div className="metric-label">token</div><div className="metric-value" style={{ fontSize: 15 }}>{goal.tokens.used}{goal.tokens.limit ? `/${goal.tokens.limit}` : ''}</div></div>
                <div className="metric"><div className="metric-label">没进展</div><div className="metric-value" style={{ fontSize: 15 }}>{goal.noProgressRounds} 轮</div></div>
              </div>
              {goal.state === 'blocked' && (
                <div className="route-detail" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
                  被挡住：{goal.blockedReason}
                  <div style={{ marginTop: 4 }}>先放宽预算或改写目标再继续——直接点继续只会以同样的原因再停一次。</div>
                </div>
              )}
              {goalError && <div className="route-detail" style={{ color: 'var(--danger)' }}>{goalError}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {goal.state === 'active' && <button className="btn ghost sm" disabled={sending} onClick={() => void applyGoal('pause')}>暂停</button>}
                {(goal.state === 'paused' || goal.state === 'blocked') && (
                  <button className="btn sm" disabled={sending} onClick={() => void applyGoal('resume', { relaxBudget: goalTurns !== goal.turns.used || goal.state === 'paused' })}>继续</button>
                )}
                {goal.state !== 'complete' && (
                  <button className="btn ghost sm" disabled={sending || evidence.length !== goal.acceptance.length} onClick={() => void applyGoal('complete', { evidence })}>标记完成</button>
                )}
                <button className="btn ghost sm" disabled={sending} onClick={() => void applyGoal('clear')}>清除</button>
                <span className="grow" />
                <span className="route-detail">v{goal.version}</span>
              </div>
              {goal.acceptance.length > 0 && goal.state !== 'complete' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="route-detail">「标记完成」要逐条给证据——模型自己说做完了不算。</div>
                  {goal.acceptance.map((item, index) => (
                    <input
                      key={`${item}-${index}`}
                      value={evidence[index] ?? ''}
                      onChange={e => setEvidence(prev => { const next = [...prev]; next[index] = e.target.value; return next })}
                      placeholder={`证据：${item}`}
                      aria-label={`验收证据 ${index + 1}`}
                      style={{ fontSize: 12.5 }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="inspector-card">
          <div className="inspector-title">当前模型</div>
          <div className="route-line" style={{ overflowWrap: 'anywhere' }}>{effectiveModel || (hasModels ? '未启动（去「我的模型」启动）' : '未检测到可用模型')}</div>
          <div className="route-detail">
            {windowInfo
              ? `窗口 ${windowInfo.actual ?? windowInfo.planned}${windowInfo.actual !== null && windowInfo.actual !== windowInfo.planned ? `（要的是 ${windowInfo.planned}）` : ''} · 对话预算 ${windowInfo.budget} · 单次回复上限 ${windowInfo.maxReply} · `
              : '上下文在开跑时按模型确定 · '}
            仅在本机运行 · 不调用云端 API
          </div>
          {windowInfo?.note && (
            <div className="route-detail" style={{ marginTop: 6, color: 'var(--warn)', lineHeight: 1.6 }}>{windowInfo.note}</div>
          )}
        </section>

        <section className="inspector-card">
          <div className="inspector-title">工具边界</div>
          <div className="route-detail" style={{ lineHeight: 1.7 }}>
            读写只限工作目录；读操作直接放行，写文件、改文件与执行命令逐次确认；命令只走随包白名单，不支持管道与拼接。编译与测试可以放后台跑，任务结束时还在跑的一律回收。
          </div>
        </section>
        </div>
      </aside>
      )}

      {confirm && createPortal(
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 40,
        }}>
          <div style={{
            width: 'min(560px, 92vw)', background: 'var(--surface-raised)', borderRadius: 14,
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
        </div>,
        // 模态框必须挂在 body 上：祖先 .page-stage 的入场动画（page-in，fill-mode: both）
        // 会留下 transform，而 CSS 上 transform 祖先会把 position:fixed 的包含块从视口改成它自己——
        // 结糖果框的位置因此取决于“入场动画跑完没跑完”（第 19 轮真浏览器量到）。
        document.body,
      )}
    </div>
  )
}
