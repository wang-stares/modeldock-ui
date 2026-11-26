import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, ChevronLeft, ExternalLink, File as FileIcon, FolderClosed, Globe, History, Image as ImageIcon, RefreshCw, Search, Square } from 'lucide-react'
import { agentApi, api } from '../api'
import type { GoalSnapshot, SubTasksState, WebFetchResult, WorkspaceChangeRow, WorkspaceDiff, WorkspaceEntry, WorkspaceFile, WorkspaceInfo } from '../types'

// 工作区面板（4.0.0 阶段 5）：右栏的「文件 / 预览 / 变更」三块。
//
// 三条界面规矩：
// 1. 只读。这一层没有任何写入口——写回永远走 agent 的写工具 + 确认 + 检查点，面板只负责让你看见。
// 2. 路径边界与 agent 完全一致：越界的请求后端会拒，界面原样把那句拒绝显示出来，不改写成「文件不存在」。
// 3. 截断必须说出来。看到半份文件却显示成完整，比不给更糟。

function sizeLabel(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function timeLabel(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function WorkspacePanel({ active, toast, tasks, goal }: {
  active: boolean
  toast: (message: string) => void
  /** 本次执行里出现过的子任务（来自 SSE 的 started / ended 帧） */
  tasks: { taskId: string; label: string; status: string; detail: string; ms: number; ok: boolean; phase: string }[]
  goal: GoalSnapshot | null
}) {
  const [tab, setTab] = useState<'files' | 'preview' | 'changes' | 'tasks' | 'web'>('files')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [trail, setTrail] = useState<string[]>([])
  const [file, setFile] = useState<WorkspaceFile | null>(null)
  const [changes, setChanges] = useState<WorkspaceChangeRow[]>([])
  const [changesNote, setChangesNote] = useState('')
  // 点开一行看行级 diff：一次只展开一个，避免两屏红绿看不出重点
  const [diffFor, setDiffFor] = useState<string | null>(null)
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [diffBusy, setDiffBusy] = useState(false)
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [live, setLive] = useState<SubTasksState | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const loadTree = useCallback(async (target: string) => {
    setLoading(true)
    try {
      const data = await api.workspaceTree(target)
      setEntries(data.entries)
      setError(data.error || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读目录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void loadTree(path)
    void api.workspaceInfo().then(setInfo).catch(() => { /* 统计取不到不影响列目录 */ })
  }, [active])

  // 任务页打开时每 2 秒对一次登记表：子任务是从内核的另一条执行里跑的，面板只能看登记，不能自己算
  useEffect(() => {
    if (!active || tab !== 'tasks') return
    let stopped = false
    const pull = () => { void agentApi.subtasks().then(value => { if (!stopped) setLive(value) }).catch(() => { /* 拿不到就只展示 SSE 给过的 */ }) }
    pull()
    const timer = window.setInterval(pull, 2000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [active, tab])

  async function stop(taskId: string) {
    try {
      const result = await agentApi.cancelSubtask(taskId)
      toast(result.ok ? result.note : result.error)
      await agentApi.subtasks().then(setLive).catch(() => { /* 刷新失败不影响结论 */ })
    } catch (e) {
      toast(e instanceof Error ? e.message : '停止失败')
    }
  }

  async function open(entry: WorkspaceEntry) {
    setError('')
    if (entry.isDirectory) {
      setTrail(prev => [...prev, entry.relativePath])
      await loadTree(entry.relativePath)
      return
    }
    try {
      const data = await api.workspaceFile(entry.relativePath)
      setFile(data.file)
      setError(data.error || '')
      if (data.file) setTab('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读文件失败')
    }
  }

  async function upOneLevel() {
    if (!trail.length) return
    const next = trail.slice(0, -1)
    setTrail(next)
    await loadTree(next[next.length - 1] ?? '')
  }

  async function reloadChanges() {
    setLoading(true)
    try {
      const data = await api.workspaceChanges()
      setChanges(data.changes)
      setChangesNote(data.note)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读变更失败')
    } finally {
      setLoading(false)
    }
  }

  async function openDiff(path: string) {
    if (diffFor === path) { setDiffFor(null); setDiff(null); return }
    setDiffFor(path)
    setDiff(null)
    setDiffBusy(true)
    try {
      setDiff(await api.workspaceDiff(path))
    } catch (e) {
      setDiff({ error: e instanceof Error ? e.message : '对比失败', hasBase: false })
    } finally {
      setDiffBusy(false)
    }
  }

  const [address, setAddress] = useState(() => {
    try { return localStorage.getItem('stardock.web.last') ?? '' } catch { return '' }
  })
  const [page, setPage] = useState<WebFetchResult | null>(null)
  const [fetching, setFetching] = useState(false)

  async function fetchPage(raw?: string) {
    const url = (raw ?? address).trim()
    if (!url) { setError('先填一个网址。'); return }
    setAddress(url)
    try { localStorage.setItem('stardock.web.last', url) } catch { /* 隐私模式忽略 */ }
    setFetching(true)
    setError('')
    try {
      const result = await api.webFetch(url)
      setPage(result)
      if (result.error) setError(result.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : '抓取失败')
      setPage(null)
    } finally {
      setFetching(false)
    }
  }

  const runningCount = live?.running.length ?? tasks.filter(item => item.phase === 'started' && item.status === 'running').length

  const shown = useMemo(() => {
    if (!filter.trim()) return entries
    const needle = filter.trim().toLowerCase()
    return entries.filter(item => item.name.toLowerCase().includes(needle))
  }, [entries, filter])

  return (
    <div className="workspace-panel">
      <div className="ws-tabs" role="tablist" aria-label="工作区">
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
          <FolderClosed />文件
        </button>
        <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
          <FileIcon />预览
        </button>
        <button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => { setTab('changes'); void reloadChanges() }}>
          <History />变更
        </button>
        <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>
          <Bot />任务{runningCount ? ` ${runningCount}` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'web'} className={tab === 'web' ? 'on' : ''} onClick={() => setTab('web')}>
          <Globe />浏览器
        </button>
      </div>

      {error && <div className="ws-error">{error}</div>}

      {tab === 'files' && (
        <>
          <div className="ws-bar">
            {trail.length > 0 && <button className="btn ghost icon sm" onClick={() => void upOneLevel()} aria-label="上一层"><ChevronLeft /></button>}
            <span className="ws-path" title={info?.root}>{path || '工作目录'}</span>
            <span className="grow" />
            <button className="btn ghost icon sm" onClick={() => void loadTree(path)} aria-label="刷新"><RefreshCw /></button>
          </div>
          <label className="ws-filter">
            <Search />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="筛选当前目录" aria-label="筛选文件" />
          </label>
          {info && (
            <div className="ws-meta">
              {/* 按非空片段拼：原先 {sizeLabel} 后面无条件跟一个「·」，
                  大小为空时界面就显示成「1 个目录 · · 面板只读」（真浏览器里量到）。 */}
              {[`${info.files} 个文件`, info.folders > 0 ? `${info.folders} 个目录` : '', info.sizeLabel, '面板只读，写回由 agent 逐次问你']
                .filter(part => part.trim().length > 0)
                .join(' · ')}
            </div>
          )}
          <div className="ws-list">
            {!info?.exists && <div className="ws-empty">工作目录还不存在。agent 第一次写文件时会建起来。</div>}
            {info?.exists && !shown.length && !loading && <div className="ws-empty">这一层没有可显示的文件（噪音目录如 node_modules、.git 会跳过）。</div>}
            {shown.map(entry => (
              <button key={entry.relativePath} className="ws-row" onClick={() => void open(entry)} title={entry.relativePath}>
                {entry.isDirectory ? <FolderClosed /> : entry.name.match(/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i) ? <ImageIcon /> : <FileIcon />}
                <span className="ws-name">{entry.name}</span>
                <span className="ws-size">{entry.isDirectory ? `${entry.children < 0 ? '?' : entry.children} 项` : sizeLabel(entry.size)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'preview' && (
        <div className="ws-preview">
          {!file && <div className="ws-empty">从「文件」里点一项来看内容。预览是只读的。</div>}
          {file && (
            <>
              <div className="ws-preview-head">
                <span className="ws-path" title={file.relativePath}>{file.relativePath}</span>
                <span className="chip">{kindLabel(file.kindKey)}</span>
                <span className="grow" />
                <span className="ws-size">{sizeLabel(file.size)}</span>
              </div>
              {file.note && <div className="ws-meta">{file.note}</div>}
              {file.kindKey === 'image' && file.dataUrl && <img className="ws-image" src={file.dataUrl} alt={file.relativePath} />}
              {file.kindKey === 'missing' && <div className="ws-empty">文件不存在，可能已被移动或删除。</div>}
              {file.kindKey === 'needs-shell' && (
                <div className="ws-empty">
                  这一版还不渲染这类文件。<div className="ws-meta">可以叫 agent 抽出文字，或用系统程序打开。</div>
                </div>
              )}
              {file.kindKey === 'binary' && <div className="ws-empty">二进制文件，不显示内容。</div>}
              {(file.kindKey === 'text' || file.kindKey === 'markdown' || file.kindKey === 'code' || file.kindKey === 'document') && (
                <pre className="ws-text">{file.text}</pre>
              )}
              {file.truncated && <div className="ws-meta">上面不是全文。</div>}
            </>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="ws-tasks">
          <div className="ws-bar">
            <span className="ws-path">子任务</span>
            <span className="grow" />
            <button className="btn ghost icon sm" onClick={() => void agentApi.subtasks().then(setLive).catch(() => undefined)} aria-label="刷新"><RefreshCw /></button>
          </div>

          {goal && (
            <div className="ws-goal">
              <div className="ws-meta">目标（{goal.stateLabel}）</div>
              <div className="ws-name" title={goal.objective}>{goal.objective}</div>
              <div className="ws-meta">
                轮次 {goal.turns.used}{goal.turns.limit ? `/${goal.turns.limit}` : ''}
                {' '}· 时间 {goal.minutesUsed}{goal.wallClock.limit ? `/${goal.wallClock.limit}` : ''} 分
                {' '}· token {goal.tokens.used}{goal.tokens.limit ? `/${goal.tokens.limit}` : ''}
                {goal.armed ? ' · 已授权自动续跑' : ' · 未授权自动续跑'}
              </div>
            </div>
          )}

          {live && (
            <div className="ws-meta">
              并发槽 {live.running.length}/{live.capacity} · 模型请求同时在飞 {live.inflightLimit} 个
              ：子体可以并行做读与搜索，但推理是一条队（本地单后端并行打推理会让吞吐塔崖式下跌）
            </div>
          )}

          {live?.running.length ? live.running.map(item => (
            <div className="ws-row static" key={item.id}>
              <Bot />
              <span className="ws-name" title={item.objective}>{item.label || item.agent}</span>
              <span className="chip accent">进行中 {item.secondsRunning} 秒</span>
              <button className="btn ghost icon sm" onClick={() => void stop(item.id)} aria-label="停掉这个子任务" title={`停掉 ${item.id}`}> <Square /></button>
            </div>
          )) : null}

          {!live?.running.length && !tasks.length && (
            <div className="ws-empty">现在没有子任务。需要扫一堆文件或查资料时，主 agent 会自己派一个只读的子体去做。</div>
          )}

          {tasks.length > 0 && (
            <>
              <div className="ws-meta" style={{ marginTop: 6 }}>本次执行的子任务</div>
              {tasks.map(item => (
                <div className="ws-row static" key={`${item.taskId}-${item.phase}`}>
                  <FileIcon />
                  <span className="ws-name" title={item.detail}>{item.label || item.taskId}</span>
                  <span className={`chip ${item.status === 'completed' ? 'success' : item.status === 'cancelled' || item.status === 'rejected' ? 'danger' : item.status === 'running' ? 'accent' : 'warn'}`}>
                    {subtaskLabel(item.status)}
                  </span>
                  <span className="ws-size">{item.ms ? `${(item.ms / 1000).toFixed(1)} 秒` : ''}</span>
                </div>
              ))}
            </>
          )}

          {tasks.some(item => item.status === 'cancelled') && (
            <div className="ws-meta">被停掉的子任务不会被重新派同一个：主 agent 拿到的是「不要对它再发消息」，不是空结果。</div>
          )}
        </div>
      )}

      {tab === 'web' && (
        <div className="ws-web">
          <div className="ws-bar">
            <input
              className="ws-address"
              value={address}
              onChange={e => setAddress(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void fetchPage() }}
              placeholder="输入网址，回车读取正文"
              aria-label="网址"
              spellCheck={false}
            />
            <button className="btn primary sm" disabled={fetching} onClick={() => void fetchPage()}>{fetching ? '读取中' : '读取'}</button>
          </div>
          <div className="ws-meta">
            阅读模式：只取正文与链接，不执行页面脚本、不带登录态、不下载图片。要真实渲染请用系统浏览器。
          </div>
          {error && <div className="ws-error">{error}</div>}
          {page && !page.error && (
            <>
              <div className="ws-preview-head">
                <span className="ws-path" title={page.url}>{page.title || page.url}</span>
                <span className="grow" />
                <button className="btn ghost icon sm" title="复制地址" onClick={() => { void navigator.clipboard?.writeText(page.url); toast('地址已复制') }}><ExternalLink /></button>
              </div>
              <div className="ws-meta">{page.note}</div>
              <pre className="ws-text">{page.text}</pre>
              {page.links.length > 0 && (
                <div className="ws-links">
                  <div className="ws-meta">链接 {page.links.length} 条（点了不在这个窗口里导航，只复制地址）</div>
                  {page.links.map(link => (
                    <button className="ws-row" key={link.index} onClick={() => { void navigator.clipboard?.writeText(link.href); toast('已复制链接地址') }} title={link.href}>
                      <span className="ws-size">{link.index}</span>
                      <span className="ws-name">{link.text}</span>
                      <span className={`chip ${link.external ? 'warn' : ''}`}>{link.external ? '外链' : '站内'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'changes' && (
        <div className="ws-changes">
          <div className="ws-bar">
            <span className="ws-path">agent 改了什么</span>
            <span className="grow" />
            <button className="btn ghost icon sm" onClick={() => void reloadChanges()} aria-label="刷新"><RefreshCw /></button>
          </div>
          {changesNote && <div className="ws-meta">{changesNote}</div>}
          {!changes.length && !loading && <div className="ws-empty">还没有改动记录。数据来自检查点与工具审计，不另记一本账。</div>}
          {changes.map(item => (
            <div key={`${item.relativePath}-${item.at}`}>
              <button className="ws-row" onClick={() => void openDiff(item.relativePath)} title={item.reversible ? '看行级差异' : '没有改动前的备份，比不出行级差异'}>
                <History />
                <span className="ws-name">{item.relativePath}</span>
                <span className={`chip ${item.action === 'attempted' ? 'warn' : item.reversible ? 'success' : ''}`}>
                  {item.actionLabel || actionLabel(item.action)}{item.reversible ? ' · 可回退' : ''}
                </span>
                <span className="ws-size">{timeLabel(item.at)}</span>
              </button>
              {diffFor === item.relativePath && (
                <div className="ws-diff">
                  {diffBusy && <div className="ws-meta">正在对比…</div>}
                  {!diffBusy && diff?.error && <div className="ws-error">{diff.error}</div>}
                  {!diffBusy && !diff?.error && diff && !diff.hasBase && <div className="ws-meta">{diff.note}</div>}
                  {!diffBusy && diff?.hasBase && (
                    <>
                      <div className="ws-meta">
                        {(diff.added ?? 0) > 0 || (diff.removed ?? 0) > 0 ? `+${diff.added} / −${diff.removed}` : '没有行内容差异'}
                        {diff.note ? ` · ${diff.note}` : ''}
                      </div>
                      {diff.fallback && <div className="ws-error">{diff.fallback}</div>}
                      {(diff.hunks ?? []).map(hunk => (
                        <div className="ws-hunk" key={hunk.header}>
                          <div className="ws-hunk-head">{hunk.header}</div>
                          {hunk.lines.map((line, index) => (
                            <div className={`ws-dl ${line.kind === '+' ? 'add' : line.kind === '-' ? 'del' : ''}`} key={`${hunk.header}-${index}`}>
                              <span className="ws-dl-no">{line.kind === '+' ? '' : line.old}</span>
                              <span className="ws-dl-no">{line.kind === '-' ? '' : line.new}</span>
                              <span className="ws-dl-mark">{line.kind}</span>
                              <span className="ws-dl-text">{line.text || ' '}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {!diff.fallback && !(diff.hunks ?? []).length && (
                        <div className="ws-meta">两边内容一样{diff.eolOnly ? '（只有行尾风格不同）' : ''}。</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {!!changes.length && (
            <div className="ws-meta">
              要撤销某一份的原样，说「把 {changes[0].relativePath} 恢复到改动前」，agent 会从检查点取回它。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function subtaskLabel(status: string) {
  return status === 'running' ? '进行中'
    : status === 'completed' ? '完成'
      : status === 'partial' ? '部分完成'
        : status === 'budget_exhausted' ? '轮次用完'
          : status === 'timeout' ? '时间用完'
            : status === 'cancelled' ? '被停止'
              : status === 'rejected' ? '被拒绝' : status === 'failed' ? '出错' : status
}

function kindLabel(kind: string) {
  return kind === 'markdown' ? 'Markdown'
    : kind === 'code' ? '代码'
      : kind === 'image' ? '图片'
        : kind === 'document' ? '办公文档（抽文字）'
          : kind === 'needs_shell' ? '需要渲染器'
            : kind === 'binary' ? '二进制'
              : kind === 'too-large' ? '过大'
                : kind === 'missing' ? '不存在' : '文本'
}

function actionLabel(action: string) {
  return action === 'new' ? '新建' : action === 'deleted' ? '删除' : action === 'attempted' ? '试过' : '修改'
}
