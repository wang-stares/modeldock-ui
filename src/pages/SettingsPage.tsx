import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  AlertCircle, ArrowLeft, Bell, Check, ChevronDown, ChevronRight, Compass, Copy, Download,
  ExternalLink, FileText, FolderOpen, Gauge, Keyboard, Layers, Megaphone,
  Monitor, Moon, Palette, RefreshCw, RotateCcw, Search, SlidersHorizontal,
  Sun, Trash2, Waves, X,
} from 'lucide-react'
import { api, agentApi, getRuntimeVersion } from '../api'
import { releaseHistory, releaseHistoryStable, type ReleaseHistoryItem, type ReleaseNoteSection } from '../data/releaseHistory'
import { APP_VERSION } from '../version'
import type {
  AgentMemoryInfo, AppSettings, AutostartState, DiagnosticLogStatus, Edge0State, GpuRuntimeState, HardwareProfile,
  ModelDirectoryState, ModelSourcesState, StorageOverview, UpdateCheck, UpdateOutcome,
} from '../types'
import { formatBytes, formatReleaseDate, noteLines, useUpdateDownload } from '../components/UpdatePanel'
import { BrandMark } from '../components/BrandMark'
import { FontLibrary } from '../components/FontLibrary'
import { ThemeIcon, StartupIcon, ChatIcon, FontIcon, ModelIcon, StorageIcon, AgentIcon, UpdateIcon, LogIcon, AboutIcon } from '../components/SettingsIcons'

const accents = [
  { name: 'Miuix 蓝', value: '#3482ff' },
  { name: '深蓝', value: '#277af7' },
  { name: '湖青', value: '#0a9e8c' },
  { name: '莓红', value: '#d64570' },
  { name: '石墨', value: '#5b6472' },
]

type SettingsGroupId = 'appearance' | 'startup' | 'inference' | 'storage' | 'agent' | 'chat' | 'fonts' | 'update' | 'diagnostics' | 'about'
type SettingsSection = SettingsGroupId | 'about' | 'updates'

const sectionMeta: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
  appearance: {
    eyebrow: 'Appearance & theme',
    title: '外观与主题',
    description: '主题、窗口材质与强调色。切换外观立即生效，不再和窗口行为挤在同一张卡里。',
  },
  startup: {
    eyebrow: 'Startup & window',
    title: '启动与窗口',
    description: '启动页动画、启动后落点、关闭窗口与登录自启。登录自启可以只在托盘里待命，不抢当前窗口。',
  },
  inference: {
    eyebrow: 'Models & inference',
    title: '模型与推理',
    description: '推理后端、设备信息、显卡加速、内置推理高级参数、Edge0 连接与模型来源。高级参数改动要重启模型才生效。',
  },
  storage: {
    eyebrow: 'Storage & downloads',
    title: '存储与数据',
    description: '数据与模型目录、磁盘占用、更新缓存与日志清理，以及下载并发、限速和完成通知。',
  },
  agent: {
    eyebrow: 'Agent & network',
    title: 'Agent 与联网',
    description: '代理联网读取网页的授权，以及本机记忆的概览与清空。审计日志和项目经验不会被这里的按钮删掉。',
  },
  chat: {
    eyebrow: 'Chat & input',
    title: '对话与输入',
    description: '发送键、阅读字号、长行换行和默认 Agent 形态。字号只改对话阅读区，不影响设置页与导航。',
  },
  fonts: {
    eyebrow: 'Font library',
    title: '字体库',
    description: '浏览、预览和按需下载多语言字体，或上传自己的字体。字体只作用于对话阅读区，界面继续使用系统字体。',
  },
  update: {
    eyebrow: 'Updates & release notes',
    title: '更新与公告',
    description: '启动检查、自动下载、增量更新、测试通道、诊断与当前版本；更新公告在页脚单独展开。',
  },
  diagnostics: {
    eyebrow: 'Logs & diagnostics',
    title: '日志与诊断',
    description: '按需开启本地诊断日志，实时记录启动、更新、模型、对话与异常；按天数或总量自动清理。日志只留在本机，不会上传。',
  },
  about: {
    eyebrow: 'About',
    title: '关于天枢',
    description: '版本信息、应用框架、设计规范与上手指引。',
  },
  updates: {
    eyebrow: 'Release notes',
    title: '更新公告',
    description: '收录 v1.0.0 起每个版本的完整公告。当前版本置顶，历史版本按主版本分组；只读，随安装包发布。',
  },
}

function themeLabel(value: AppSettings['theme']) {
  return value === 'light' ? '浅色' : value === 'dark' ? '深色' : '跟随系统'
}

function materialLabel(value: AppSettings['material']) {
  return value === 'acrylic' ? '亚克力' : value === 'mica' ? '云母' : '纯色'
}

function backendLabel(value: AppSettings['backend']) {
  return value === 'auto' ? '自动探测' : value === 'ollama' ? 'Ollama' : value === 'edge0' ? 'Edge0' : '内置 llama.cpp'
}

function fontLabel(value: string) {
  if (value === 'system') return '系统字体'
  if (value === 'misans') return 'MiSans'
  if (value.startsWith('catalog:')) return '字体库'
  if (value.startsWith('custom:')) return '自定义字体'
  return '系统字体'
}

function cleanCpuName(name?: string) {
  return name?.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim() || '正在读取硬件'
}

/** Release 标题已带（YYMMDD）时不再追加发布日期，避免界面出现两个日期。 */
function releaseNameLabel(name: string, version: string, publishedAt: string) {
  const label = name || `v${version}`
  const hasDateCode = /（\d{6}）/.test(label)
  return `${label}${publishedAt && !hasDateCode ? ` · ${formatReleaseDate(publishedAt)} 发布` : ''}`
}

function Toggle({ checked, label, onChange, disabled = false }: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`source-switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="source-switch-knob" aria-hidden />
    </button>
  )
}

function SectionHeader({ section, onBack }: { section: SettingsSection; onBack: () => void }) {
  const meta = sectionMeta[section]
  return (
    <>
      <button type="button" className="settings-back" onClick={onBack}>
        <ArrowLeft aria-hidden />返回设置
      </button>
      <div className="page-head settings-detail-head">
        <div className="page-head-copy">
          <div className="eyebrow">{meta.eyebrow}</div>
          <h1 className="page-title">{meta.title}</h1>
          <p className="page-sub">{meta.description}</p>
        </div>
      </div>
    </>
  )
}

/* ── 外观与主题 ─────────────────────────────────────────────────────── */

function AutostartSettings() {
  const [state, setState] = useState<AutostartState | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    void api.autostart().then(next => { if (alive) setState(next) })
      .catch(() => { if (alive) setNote('读取开机自启状态失败，稍后重试。') })
    return () => { alive = false }
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    setNote('')
    try {
      setState(await api.setAutostart(next, state?.startMinimized === true))
      setNote(next ? '已写入当前用户的启动项，下次登录会启动天枢。' : '已移除当前用户的启动项。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '修改开机自启失败')
    } finally { setBusy(false) }
  }

  async function toggleMinimized(next: boolean) {
    if (!state?.enabled) return
    setBusy(true)
    setNote('')
    try {
      setState(await api.setAutostart(true, next))
      setNote(next ? '下次登录会在托盘待命，不主动弹出主窗口。' : '下次登录会正常打开主窗口。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '修改登录启动行为失败')
    } finally { setBusy(false) }
  }

  const stale = state?.enabled && state.registeredPath &&
    state.appPath && state.registeredPath.toLowerCase() !== state.appPath.toLowerCase()

  return (
    <section className="settings-card settings-detail-card">
      <div className="settings-detail-lead">
        <span className="chip">登录与启动</span>
        <span>写当前用户的 Run 键，不请求管理员权限。</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">开机自启</div>
          <div className="setting-desc">
            登录 Windows 后自动启动天枢。写入当前用户的 <code>Run</code> 启动项，不需要管理员权限；关掉开关会删掉这一项。
          </div>
        </div>
        <Toggle
          checked={state?.enabled === true}
          label="开机自启"
          disabled={busy || !state?.supported}
          onChange={next => void toggle(next)}
        />
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">登录后只在托盘待命</div>
          <div className="setting-desc">
            只影响登录自启：启动后不弹主窗口，左键托盘图标恢复。手动打开天枢不受影响。
          </div>
        </div>
        <Toggle
          checked={state?.startMinimized === true}
          label="登录后只在托盘待命"
          disabled={busy || !state?.supported || !state?.enabled}
          onChange={next => void toggleMinimized(next)}
        />
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">注册的客户端</div>
          <div className="setting-desc">只注册安装版 Tianshu.exe；开发时单独启动的内核不会写启动项。</div>
        </div>
        <code className="settings-path">{state?.registeredPath || state?.appPath || '正在读取…'}</code>
      </div>
      {stale && <div className="settings-callout">启动项指向的位置和当前客户端不一致，通常是安装目录换过。关掉再打开一次开关即可重写。</div>}
      {(state?.error || note) && <div className="settings-callout">{state?.error || note}</div>}
    </section>
  )
}

function AppearanceSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">主题</div>
            <div className="setting-desc">跟随系统，或固定浅色 / 深色；切换后立即生效。</div>
          </div>
          <div className="segmented" role="group" aria-label="主题">
            <button type="button" className={settings.theme === 'system' ? 'active' : ''} onClick={() => onChange({ theme: 'system' })}><Monitor size={12} /> 跟随系统</button>
            <button type="button" className={settings.theme === 'light' ? 'active' : ''} onClick={() => onChange({ theme: 'light' })}><Sun size={12} /> 浅色</button>
            <button type="button" className={settings.theme === 'dark' ? 'active' : ''} onClick={() => onChange({ theme: 'dark' })}><Moon size={12} /> 深色</button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">窗口材质</div>
            <div className="setting-desc">云母采用 Windows 11 原生色调，不显示壁纸纹理；亚克力会模糊壁纸并透出背景，为新安装默认；纯色模式不透视壁纸。</div>
          </div>
          <div className="segmented" role="group" aria-label="窗口材质">
            <button type="button" className={settings.material === 'mica' ? 'active' : ''} onClick={() => onChange({ material: 'mica' })}><Waves size={12} /> 云母</button>
            <button type="button" className={settings.material === 'acrylic' ? 'active' : ''} onClick={() => onChange({ material: 'acrylic' })}><Layers size={12} /> 亚克力</button>
            <button type="button" className={settings.material === 'solid' ? 'active' : ''} onClick={() => onChange({ material: 'solid' })}><Palette size={12} /> 纯色</button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">强调色</div>
            <div className="setting-desc">默认 Miuix 蓝；仅替换强调色令牌，不引入第二套配色。</div>
          </div>
          <div className="swatches" role="group" aria-label="强调色">
            {accents.map(accent => (
              <button
                key={accent.value}
                type="button"
                title={accent.name}
                aria-label={accent.name}
                className={`swatch ${settings.accent === accent.value ? 'active' : ''}`}
                style={{ background: accent.value }}
                onClick={() => onChange({ accent: accent.value })}
              >
                {settings.accent === accent.value && <Check size={12} color="white" />}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-callout">
          若材质显示为纯色，请确认 Windows「设置 → 个性化 → 颜色 → 透明效果」已开启。
          <button
            type="button"
            className="inline-link"
            onClick={() => { void import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_transparency_settings')).catch(() => { /* browser preview */ }) }}
          >
            打开设置
          </button>
        </div>
      </section>
    </>
  )
}

/* ── 启动与窗口 ─────────────────────────────────────────────────────── */

function StartupSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="settings-detail-lead">
          <span className="chip">启动</span>
          <span>只影响下一次打开天枢，不改系统启动项。</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">启动页动画</div>
            <div className="setting-desc">
              完整播放入场最快约 4.2 秒；快速模式直接落到最终帧，最短约 0.8 秒，仍等本机内核真正就绪后再进入工作台。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="启动页动画">
            <button type="button" className={settings.startupSplash === 'full' ? 'active' : ''} onClick={() => onChange({ startupSplash: 'full' })}>完整</button>
            <button type="button" className={settings.startupSplash === 'quick' ? 'active' : ''} onClick={() => onChange({ startupSplash: 'quick' })}>快速</button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">启动后打开</div>
            <div className="setting-desc">
              固定进模型库、直接进对话，或记住上次离开的页面。带 <code>?page=</code> 的调试链接仍优先。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="启动后打开">
            <button type="button" className={settings.startupPage === 'library' ? 'active' : ''} onClick={() => onChange({ startupPage: 'library' })}>模型库</button>
            <button type="button" className={settings.startupPage === 'chat' ? 'active' : ''} onClick={() => onChange({ startupPage: 'chat' })}>对话</button>
            <button type="button" className={settings.startupPage === 'last' ? 'active' : ''} onClick={() => onChange({ startupPage: 'last' })}>上次页面</button>
          </div>
        </div>
      </section>

      <section className="settings-card settings-detail-card">
        <div className="settings-detail-lead">
          <span className="chip">桌面行为</span>
          <span>只影响窗口与登录，不改系统级设置。</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">关闭窗口时收进托盘</div>
            <div className="setting-desc">
              默认开启：点关闭只隐藏主窗口，内核继续在后台跑，左键托盘图标恢复。关掉后点关闭会退出应用并停掉内核；托盘菜单里的「退出」始终是真正退出。
            </div>
          </div>
          <Toggle
            checked={settings.closeToTray}
            label="关闭窗口时收进托盘"
            onChange={next => onChange({ closeToTray: next })}
          />
        </div>
      </section>

      <AutostartSettings />
    </>
  )
}

/* ── 对话与输入 ─────────────────────────────────────────────────────── */

function ChatSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="settings-detail-lead">
          <span className="chip">输入</span>
          <span>发送键与字号立即生效；默认形态在下一次启动时决定左上角选中项。</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">发送快捷键</div>
            <div className="setting-desc">
              Enter 发送时 Shift+Enter 换行；Ctrl+Enter 发送时单独 Enter 只换行。两种方式都不会发送空消息。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="发送快捷键">
            <button type="button" className={settings.chatSendKey === 'enter' ? 'active' : ''} onClick={() => onChange({ chatSendKey: 'enter' })}>Enter</button>
            <button type="button" className={settings.chatSendKey === 'ctrl-enter' ? 'active' : ''} onClick={() => onChange({ chatSendKey: 'ctrl-enter' })}>Ctrl+Enter</button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">对话字号</div>
            <div className="setting-desc">只改消息正文与输入框，不改设置页、导航与卡片字号。</div>
          </div>
          <div className="segmented" role="group" aria-label="对话字号">
            <button type="button" className={settings.chatFontSize === 'small' ? 'active' : ''} onClick={() => onChange({ chatFontSize: 'small' })}>小</button>
            <button type="button" className={settings.chatFontSize === 'standard' ? 'active' : ''} onClick={() => onChange({ chatFontSize: 'standard' })}>标准</button>
            <button type="button" className={settings.chatFontSize === 'large' ? 'active' : ''} onClick={() => onChange({ chatFontSize: 'large' })}>大</button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">长行自动换行</div>
            <div className="setting-desc">关闭后，代码与日志这类没有空格的超长行会横向滚动，不把气泡撑高；普通中文仍按段落换行。</div>
          </div>
          <Toggle
            checked={settings.chatWrapLong}
            label="长行自动换行"
            onChange={next => onChange({ chatWrapLong: next })}
          />
        </div>
      </section>

      <section className="settings-card settings-detail-card">
        <div className="settings-detail-lead">
          <span className="chip">默认形态</span>
          <span>标题栏左上角的当前选择仍以本次会话为准。</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">启动时默认 Agent</div>
            <div className="setting-desc">
              沿用上次选择，或每次启动固定为办公 / 编程。办公只读写工作区，不执行命令；编程仍要逐次确认命令。
            </div>
          </div>
          <div className="segmented" role="group" aria-label="启动时默认 Agent">
            <button type="button" className={settings.defaultAgentMode === 'last' ? 'active' : ''} onClick={() => onChange({ defaultAgentMode: 'last' })}>上次</button>
            <button type="button" className={settings.defaultAgentMode === 'office' ? 'active' : ''} onClick={() => onChange({ defaultAgentMode: 'office' })}>办公</button>
            <button type="button" className={settings.defaultAgentMode === 'code' ? 'active' : ''} onClick={() => onChange({ defaultAgentMode: 'code' })}>编程</button>
          </div>
        </div>
      </section>
    </>
  )
}

/* ── 模型与推理 ─────────────────────────────────────────────────────── */

function GpuRuntimeSettings() {
  const [state, setState] = useState<GpuRuntimeState | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    void api.gpuRuntime().then(next => { if (alive) setState(next) })
      .catch(() => { if (alive) setNote('读取显卡加速组件状态失败，稍后重试。') })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!state?.busy) return
    let alive = true
    const timer = window.setInterval(() => {
      void api.gpuRuntime().then(next => { if (alive) setState(next) }).catch(() => { /* 轮询失败时保留上一次状态 */ })
    }, 800)
    return () => { alive = false; window.clearInterval(timer) }
  }, [state?.busy])

  async function install() {
    setBusy(true)
    setNote('')
    try {
      const result = await api.installGpuRuntime()
      setState(result.status)
      setNote(result.message)
    } catch (e) {
      setNote(e instanceof Error ? e.message : '安装显卡加速组件失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('卸载显卡加速组件？下次启动模型会改用 CPU，不会影响模型文件。')) return
    setBusy(true)
    setNote('')
    try {
      const result = await api.removeGpuRuntime()
      setState(result.status)
      setNote(result.message)
    } catch (e) {
      setNote(e instanceof Error ? e.message : '卸载显卡加速组件失败')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    try {
      setState(await api.cancelGpuRuntime())
    } catch (e) {
      setNote(e instanceof Error ? e.message : '取消失败')
    }
  }

  const phase: Record<string, string> = {
    preparing: '准备下载',
    downloading: '下载中',
    verifying: '校验中',
    installing: '安装中',
    done: '已完成',
    cancelled: '已取消',
    error: '失败',
  }
  const installed = state?.state === 'installed'
  const bundled = state?.state === 'bundled'
  const canInstall = !!state && !bundled && !installed && state.hasVulkan && !state.busy
  const progress = Math.round((state?.progress ?? 0) * 100)

  return (
    <section className="settings-card settings-detail-card">
      <div className="settings-detail-lead">
        <span className="chip">可选组件</span>
        <span>这是 llama.cpp 的 Vulkan 后端，不包含显卡驱动；缺少 Vulkan 驱动时只能更新驱动。</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">显卡加速组件</div>
          <div className="setting-desc">
            {bundled
              ? '安装包已内置 Vulkan 运行时，启动模型时优先走显卡。'
              : installed
                ? `已安装 · ${state?.version || '当前版本'} · ${formatBytes(state?.sizeBytes ?? 0)}`
                : state?.state === 'stale'
                  ? '已安装的组件与当前版本不匹配，需要重新安装。'
                  : state?.hasVulkan
                    ? '未安装。下载后可在启动模型时使用显卡；约 33 MB。'
                    : '未检测到 Vulkan 驱动。更新显卡驱动后，这里才能安装加速组件。'}
          </div>
        </div>
        <span className={`chip ${bundled || installed ? 'success' : state?.hasVulkan ? '' : 'warn'}`}>
          {bundled ? '已内置' : installed ? '已安装' : state?.state === 'stale' ? '需更新' : state?.hasVulkan ? '可安装' : '不可用'}
        </span>
      </div>

      {state?.busy && (
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">{phase[state.phase] || '安装中'}</div>
            <div className="setting-desc">下载和校验完成前不会替换现有运行时。</div>
          </div>
          <span className="chip">{progress}%</span>
        </div>
      )}

      {(state?.error || note) && <div className="settings-callout">{state?.error || note}</div>}

      <div className="edge0-actions">
        {canInstall && <button type="button" className="btn primary sm" disabled={busy} onClick={() => void install()}><Download />安装显卡加速</button>}
        {installed && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void remove()}><Trash2 />卸载</button>}
        {state?.busy && <button type="button" className="btn ghost sm" onClick={() => void cancel()}>取消安装</button>}
      </div>
    </section>
  )
}

function AdvancedInferenceSettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const [gpuLayers, setGpuLayers] = useState(String(settings.inferenceGpuLayers))
  const [threads, setThreads] = useState(String(settings.inferenceThreads))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { setGpuLayers(String(settings.inferenceGpuLayers)) }, [settings.inferenceGpuLayers])
  useEffect(() => { setThreads(String(settings.inferenceThreads)) }, [settings.inferenceThreads])

  function applyNumbers() {
    const gpu = Number(gpuLayers)
    const cpu = Number(threads)
    onChange({
      inferenceGpuLayers: Number.isFinite(gpu) ? Math.max(-1, Math.min(999, Math.trunc(gpu))) : -1,
      inferenceThreads: Number.isFinite(cpu) ? Math.max(0, Math.min(128, Math.trunc(cpu))) : 0,
    })
  }

  async function restartModel() {
    setBusy(true)
    setNote('')
    try {
      const state = await api.runtime()
      if (state.kind !== 'embedded') {
        setNote('当前运行的是 ' + (state.backend || '其它后端') + '，内置推理参数会在下次切到内置时生效。')
        return
      }
      const running = state.running[0]
      if (!running) {
        setNote('当前没有驻留的内置模型；下次启动会按新参数加载。')
        return
      }
      const unloaded = await api.unloadModel(running.name)
      if (!unloaded.ok) { setNote(unloaded.message); return }
      const loaded = await api.loadModel(running.name)
      setNote(loaded.message)
    } catch (e) {
      setNote(e instanceof Error ? e.message : '重启模型失败')
    } finally { setBusy(false) }
  }

  return (
    <section className="settings-card settings-detail-card">
      <div className="settings-detail-lead">
        <span className="chip">高级参数</span>
        <span>只在「内置 llama.cpp」后端生效；Ollama 与 Edge0 使用各自的参数。</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">上下文窗口</div>
          <div className="setting-desc">容纳对话预算和单次回复的窗口。自动档按 Agent 预算算，最低 12800；调大会多占内存 / 显存。</div>
        </div>
        <select
          className="settings-input settings-select"
          aria-label="上下文窗口"
          value={settings.inferenceContext}
          onChange={e => onChange({ inferenceContext: Number(e.target.value) })}
        >
          <option value={0}>自动 · 12800</option>
          <option value={16384}>16384 · 16K</option>
          <option value={32768}>32768 · 32K</option>
          <option value={65536}>65536 · 64K</option>
          <option value={131072}>131072 · 128K</option>
        </select>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">GPU 层数</div>
          <div className="setting-desc">-1 表示按可用显存自动选；0 表示全部放 CPU。显存不够时先把层数调低。</div>
        </div>
        <div className="settings-number-group">
          <input
            className="settings-input settings-number"
            type="number"
            min={-1}
            max={999}
            value={gpuLayers}
            aria-label="GPU 层数"
            onChange={e => setGpuLayers(e.target.value)}
            onBlur={applyNumbers}
          />
          <button type="button" className="btn ghost sm" onClick={() => { setGpuLayers('-1'); onChange({ inferenceGpuLayers: -1 }) }}>自动</button>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">推理线程</div>
          <div className="setting-desc">0 表示由 llama.cpp 按物理核自动决定；手动设置时不要超过物理核数太多。</div>
        </div>
        <div className="settings-number-group">
          <input
            className="settings-input settings-number"
            type="number"
            min={0}
            max={128}
            value={threads}
            aria-label="推理线程"
            onChange={e => setThreads(e.target.value)}
            onBlur={applyNumbers}
          />
          <button type="button" className="btn ghost sm" onClick={() => { setThreads('0'); onChange({ inferenceThreads: 0 }) }}>自动</button>
        </div>
      </div>
      <div className="settings-actions">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void restartModel()}>
          <RefreshCw className={busy ? 'spin' : ''} />重启当前模型
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onChange({ inferenceContext: 0, inferenceGpuLayers: -1, inferenceThreads: 0 })}
        >
          <RotateCcw />恢复自动
        </button>
      </div>
      {note && <div className="settings-callout">{note}</div>}
    </section>
  )
}

function InferenceSettings({ hardware, settings, onChange, onSourcesChange }: {
  hardware: HardwareProfile | null
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onSourcesChange: (state: ModelSourcesState) => void
}) {
  const [edge0, setEdge0] = useState<Edge0State | null>(null)
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8000')
  const [alias, setAlias] = useState('')
  const [modelDir, setModelDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    void api.edge0().then(state => {
      if (!alive) return
      setEdge0(state)
      setEndpoint(state.settings.endpoint)
      setAlias(state.settings.modelAlias)
      setModelDir(state.settings.modelDirectory)
    }).catch(() => { if (alive) setNote('读取 Edge0 设置失败，稍后重试。') })
    return () => { alive = false }
  }, [])

  async function saveEdge0() {
    setBusy(true)
    setNote('')
    try {
      const state = await api.saveEdge0({ endpoint, modelAlias: alias, modelDirectory: modelDir })
      setEdge0(state)
      setEndpoint(state.settings.endpoint)
      setNote(state.status.available ? '已保存，Edge0 服务在线。' : '已保存；服务当前未启动。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  async function probeEdge0() {
    setBusy(true)
    setNote('')
    try {
      const status = await api.probeEdge0()
      setEdge0(prev => prev ? { ...prev, status } : { settings: { endpoint, modelAlias: alias, modelDirectory: modelDir }, status })
      setNote(status.detail)
    } catch (e) {
      setNote(e instanceof Error ? e.message : '探测失败')
    } finally { setBusy(false) }
  }

  function openExternal(url: string) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_url', { url }))
      .catch(() => { window.open(url, '_blank', 'noreferrer') })
  }

  const edge0Online = edge0?.status.available === true

  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">推理后端</div>
            <div className="setting-desc">默认按 Ollama → Edge0 → 内置 llama.cpp 顺序探测；也可固定指定后端，避免自动切换。</div>
          </div>
          <div className="segmented" role="group" aria-label="推理后端">
            <button type="button" className={settings.backend === 'auto' ? 'active' : ''} onClick={() => onChange({ backend: 'auto' })}>自动</button>
            <button type="button" className={settings.backend === 'ollama' ? 'active' : ''} onClick={() => onChange({ backend: 'ollama' })}>Ollama</button>
            <button type="button" className={settings.backend === 'edge0' ? 'active' : ''} onClick={() => onChange({ backend: 'edge0' })}>Edge0</button>
            <button type="button" className={settings.backend === 'embedded' ? 'active' : ''} onClick={() => onChange({ backend: 'embedded' })}>内置</button>
          </div>
        </div>

        <div className="settings-detail-lead">
          <span className="chip">硬件信息只读</span>
          <span>数据来自设备探测，不会修改系统设置。</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">处理器</div>
            <div className="setting-desc">{hardware?.cpuName || '未识别'}</div>
          </div>
          <span className="chip">{hardware?.coreText || '—'}</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">内存</div>
            <div className="setting-desc">系统可见 / 当前可用</div>
          </div>
          <span className="chip">{hardware?.ramText || '—'}</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">显卡</div>
            <div className="setting-desc">显存优先用于推理预算</div>
          </div>
          <span className="chip">{hardware?.hasGpu ? `${hardware.gpuName} · ${hardware.gpuMemoryGb.toFixed(1)} GB` : '未识别独显'}</span>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">推理预算</div>
            <div className="setting-desc">按内存与显存估算的单次模型运行预算</div>
          </div>
          <span className="chip">{hardware ? `${hardware.budgetGb.toFixed(1)} GB` : '—'}</span>
        </div>
      </section>

      <GpuRuntimeSettings />
      <AdvancedInferenceSettings settings={settings} onChange={onChange} />

      <section className="settings-card settings-detail-card">
        <div className="edge0-head">
          <div>
            <div className="setting-name">Edge0 · 无界方舟</div>
            <div className="setting-desc">连接本机 edge0-infer serve 的 OpenAI 兼容接口，默认 127.0.0.1:8000/v1；天枢不管理该进程，也不下载 106 GB 权重包。</div>
          </div>
          <span className={`chip ${edge0Online ? 'accent' : ''}`}>{edge0Online ? '服务在线' : '服务未连接'}</span>
        </div>
        <div className="setting-row edge0-field">
          <div className="setting-copy"><div className="setting-name">服务地址</div></div>
          <input className="settings-input" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://127.0.0.1:8000" aria-label="Edge0 服务地址" />
        </div>
        <div className="setting-row edge0-field">
          <div className="setting-copy"><div className="setting-name">模型别名</div><div className="setting-desc">serve 的 --alias；145B 默认 edge0_145b，120B 默认 edge0_120b。</div></div>
          <input className="settings-input" value={alias} onChange={e => setAlias(e.target.value)} placeholder="edge0_145b" aria-label="Edge0 模型别名" />
        </div>
        <div className="setting-row edge0-field">
          <div className="setting-copy"><div className="setting-name">权重目录</div><div className="setting-desc">可选，只用于生成启动命令；天枢不会读取或改动里面的文件。</div></div>
          <input className="settings-input" value={modelDir} onChange={e => setModelDir(e.target.value)} placeholder="D:\Edge0\Edge0-145B-q3k" aria-label="Edge0 权重目录" />
        </div>
        <div className="edge0-actions">
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void saveEdge0()}><Check />保存</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void probeEdge0()}><RefreshCw />测试连接</button>
          <button type="button" className="btn ghost sm" onClick={() => openExternal('https://huggingface.co/Edge0')}><ExternalLink />Hugging Face</button>
          <button type="button" className="btn ghost sm" onClick={() => openExternal('https://modelscope.cn/organization/Edge0')}><ExternalLink />魔搭</button>
          <button type="button" className="btn ghost sm" onClick={() => openExternal('https://github.com/Edge0-AI/Edge0')}><ExternalLink />官方框架</button>
        </div>
        <div className="settings-callout">
          先启动服务，再在对话页选 Edge0：<code>edge0-infer serve --model &lt;权重目录&gt; --alias edge0_145b --port 8000</code>
          {modelDir.trim() && <button type="button" className="inline-link" onClick={() => {
            void navigator.clipboard?.writeText(`edge0-infer serve --model "${modelDir.trim()}" --alias ${alias.trim() || 'edge0_145b'} --port ${(endpoint.match(/:(\d+)/) || [])[1] || '8000'}`)
            setNote('启动命令已复制')
          }}>复制启动命令</button>}
        </div>
        {edge0 && <div className="edge0-status"><i className={`status-dot ${edge0Online ? '' : 'off'}`} />{edge0.status.detail}</div>}
        {note && <div className="settings-note" style={{ paddingLeft: 0 }}>{note}</div>}
      </section>

      <SourcesSettings onStateChange={onSourcesChange} />
    </>
  )
}

/* ── 模型来源 ───────────────────────────────────────────────────────── */

function SourcesSettings({ onStateChange }: { onStateChange: (state: ModelSourcesState) => void }) {
  const [state, setState] = useState<ModelSourcesState | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    let alive = true
    void api.sources().then(next => {
      if (!alive) return
      setState(next)
      onStateChange(next)
    }).catch(() => {
      if (alive) setNote('读取模型来源设置失败，稍后重试。')
    })
    return () => { alive = false }
  }, [onStateChange])

  const openCsg = state?.sources.find(source => source.id === 'opencsg')

  async function toggle(source: ModelSourcesState['sources'][number]) {
    setBusy(source.id)
    setNote('')
    try {
      const next = await api.saveSource(source.id, { enabled: !source.enabled })
      setState(next)
      onStateChange(next)
      if (source.id === 'opencsg' && !source.enabled) {
        setNote(next.sources.find(item => item.id === 'opencsg')?.tokenConfigured
          ? 'OpenCSG 已开启；下载会使用已保存的 Access Token。'
          : 'OpenCSG 已开启；配置 Access Token 后才会参与模型库与下载。')
      } else {
        setNote(`${source.name}${source.enabled ? ' 已关闭' : ' 已启用'}。`)
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy('') }
  }

  async function saveToken() {
    if (!token.trim() && !openCsg?.tokenConfigured) {
      setNote('请先粘贴 Access Token，再保存 OpenCSG 配置。')
      return
    }
    setBusy('opencsg-token')
    setNote('')
    try {
      const next = await api.saveSource('opencsg', { enabled: true, token: token.trim() })
      setState(next)
      onStateChange(next)
      setToken('')
      setNote('Access Token 已保存；OpenCSG 将参与模型库与下载。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy('') }
  }

  function openExternal(url: string) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_url', { url }))
      .catch(() => { window.open(url, '_blank', 'noreferrer') })
  }

  const descriptions: Record<string, string> = {
    modelscope: '魔搭社区目录（modelscope.cn）。默认启用，模型库与下载会直接请求。',
    'modelscope-intl': '魔搭国际站目录（modelscope.ai）。适合访问国际站更快的网络环境。',
    huggingface: 'Hugging Face 模型目录（huggingface.co）。提供国际模型目录与备用下载地址。',
    opencsg: 'OpenCSG 传神社区目录。浏览与搜索可匿名进行；GGUF 权重下载需要 Access Token。',
  }

  return (
    <>
      <section className="settings-card settings-detail-card sources-card">
        <div className="sources-head">
          <div>
            <div className="setting-name">来源清单</div>
            <div className="setting-desc">已启用的来源参与模型库搜索、推荐与下载；关闭后立即停止请求，并从下载候选中移除。</div>
          </div>
          <span className={`chip ${state && state.readyCount > 0 ? 'accent' : ''}`}>
            {state ? `${state.readyCount} 个可用` : '正在读取'}
          </span>
        </div>

        <div className="source-list">
          {state?.sources.map(source => (
            <div className="source-row" key={source.id}>
              <div className="source-copy">
                <div className="source-title-row">
                  <span className="source-name">{source.name}</span>
                  {source.requiresToken && <span className="source-badge">需 Access Token</span>}
                  <span className={`chip ${source.enabled && source.ready ? 'success' : source.enabled ? 'warn' : ''}`}>
                    {source.enabled ? (source.ready ? '已启用' : '待配置') : '已关闭'}
                  </span>
                </div>
                <div className="setting-desc">{descriptions[source.id]}</div>
              </div>
              <button
                type="button"
                className={`source-switch ${source.enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={source.enabled}
                aria-label={`${source.name}来源开关`}
                disabled={busy === source.id}
                onClick={() => void toggle(source)}
              >
                <span className="source-switch-knob" />
              </button>
            </div>
          ))}
          {!state && <div className="source-detail">正在读取模型来源设置…</div>}
        </div>
      </section>

      {openCsg?.enabled && (
        <section className="settings-card settings-detail-card source-config">
          <div className="source-config-head">
            <div>
              <div className="setting-name">OpenCSG 连接配置</div>
              <div className="setting-desc">仅 OpenCSG 需要额外凭据。登录 opencsg.com 后，在「账号设置 → Access Token」生成并粘贴；Token 只保存在本机。</div>
            </div>
            <span className={`chip ${openCsg.tokenConfigured ? 'success' : 'warn'}`}>
              {openCsg.tokenConfigured ? 'Token 已配置' : '待配置 Token'}
            </span>
          </div>

          <div className="setting-row settings-field">
            <div className="setting-copy">
              <div className="setting-name">Access Token</div>
              <div className="setting-desc">保存后，下载请求才会携带 <code>Authorization: Bearer &lt;Token&gt;</code>；界面只显示配置状态，不回传 Token 内容。</div>
            </div>
            <input
              className="settings-input"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={openCsg.tokenConfigured ? '已保存，留空保持不变' : '粘贴 Access Token'}
              aria-label="OpenCSG Access Token"
              autoComplete="off"
            />
          </div>

          <div className="settings-actions">
            <button type="button" className="btn primary sm" disabled={busy === 'opencsg-token' || (!token.trim() && !openCsg.tokenConfigured)} onClick={() => void saveToken()}><Check />保存</button>
            <button type="button" className="btn ghost sm" onClick={() => openExternal('https://opencsg.com/settings/access-token')}><ExternalLink />获取 Access Token</button>
          </div>

          <div className="settings-callout">
            OpenCSG 开启但未配置 Token 时，只保留开关状态，不参与模型库请求与下载；Token 写入 <code>%APPDATA%\ModelDock\sources.json</code>，不写进仓库，也不会通过设置接口回传至界面。
          </div>
        </section>
      )}

      {note && <div className="settings-note" style={{ paddingLeft: 0 }}>{note}</div>}
      <p className="settings-note">来源开关修改后立即保存并重建模型目录缓存；已下载的模型文件不受影响。</p>
    </>
  )
}

/* ── 存储与数据 ─────────────────────────────────────────────────────── */

function DownloadBehaviorSettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const [limit, setLimit] = useState(String(settings.downloadLimitKbps))
  useEffect(() => { setLimit(String(settings.downloadLimitKbps)) }, [settings.downloadLimitKbps])

  function applyLimit() {
    const value = Number(limit)
    onChange({ downloadLimitKbps: Number.isFinite(value) ? Math.max(0, Math.min(1048576, Math.trunc(value))) : 0 })
  }

  return (
    <section className="settings-card settings-detail-card">
      <div className="settings-detail-lead">
        <span className="chip">下载与通知</span>
        <span>并发数按应用启动时读取，改完要重启天枢；限速对每个下载任务单独生效。</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">同时下载数</div>
          <div className="setting-desc">默认 1 路。调到 2–3 路会同时占用多个模型源的连接；重启应用后生效。</div>
        </div>
        <div className="segmented" role="group" aria-label="同时下载数">
          {[1, 2, 3].map(value => (
            <button
              key={value}
              type="button"
              className={settings.downloadConcurrency === value ? 'active' : ''}
              onClick={() => onChange({ downloadConcurrency: value })}
            >
              {value} 路
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">单任务限速</div>
          <div className="setting-desc">单位 KB/s；0 表示不限速。例如 2048 约等于 2 MB/s。保存后对下一个开始的任务生效。</div>
        </div>
        <div className="settings-number-group">
          <input
            className="settings-input settings-number"
            type="number"
            min={0}
            max={1048576}
            value={limit}
            aria-label="单任务限速"
            onChange={e => setLimit(e.target.value)}
            onBlur={applyLimit}
          />
          <span className="settings-unit">KB/s</span>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <div className="setting-name">下载完成通知</div>
          <div className="setting-desc">下载完成后弹一条应用内提示，并请求任务栏注意；不会调用系统通知中心。</div>
        </div>
        <Toggle
          checked={settings.notifyDownloadComplete}
          label="下载完成通知"
          onChange={next => onChange({ notifyDownloadComplete: next })}
        />
      </div>
    </section>
  )
}

function StorageSettings({ settings, onChange, onReset }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onReset: (next: AppSettings) => void
}) {
  const [directory, setDirectory] = useState<ModelDirectoryState | null>(null)
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  function reload() {
    let alive = true
    void Promise.all([api.modelDirectory(), api.storage()]).then(([dir, store]) => {
      if (!alive) return
      setDirectory(dir)
      setPath(current => current || dir.current)
      setOverview(store)
    }).catch(() => { if (alive) setNote('读取存储信息失败，稍后重试。') })
    return () => { alive = false }
  }

  useEffect(reload, [])

  async function save(reset = false) {
    setBusy('directory')
    setNote('')
    try {
      const result = await api.saveModelDirectory(reset ? '' : path.trim())
      if (result.directory) setDirectory(result.directory)
      if (result.ok) setPath(result.directory?.current ?? '')
      setNote(result.message)
      setOverview(await api.storage().catch(() => overview))
    } catch (e) {
      setNote(e instanceof Error ? e.message : '保存模型目录失败')
    } finally { setBusy('') }
  }

  async function cleanupUpdates() {
    if (!window.confirm('删除已下载的安装包、增量包和检查缓存？不会影响模型、会话与设置。')) return
    setBusy('updates')
    setNote('')
    try {
      const result = await api.cleanupUpdate()
      setNote(result.failed.length > 0
        ? `已清理 ${result.removed} 个文件、释放 ${formatBytes(result.freedBytes)}；有 ${result.failed.length} 个文件被占用，关闭应用后再清理一次。`
        : `已清理 ${result.removed} 个更新缓存文件，释放 ${formatBytes(result.freedBytes)}。`)
      setOverview(await api.storage().catch(() => overview))
    } catch (e) {
      setNote(e instanceof Error ? e.message : '清理更新缓存失败')
    } finally { setBusy('') }
  }

  async function cleanupLogs() {
    if (!window.confirm('删除 logs 目录下的运行日志？审计日志（agent-audit.jsonl）不会被删除。')) return
    setBusy('logs')
    setNote('')
    try {
      const result = await api.cleanupLogs()
      setNote(result.failed.length > 0
        ? `已删除 ${result.removed} 个日志、释放 ${formatBytes(result.freedBytes)}；${result.failed.join('；')}`
        : `已删除 ${result.removed} 个日志，释放 ${formatBytes(result.freedBytes)}。`)
      setOverview(await api.storage().catch(() => overview))
    } catch (e) {
      setNote(e instanceof Error ? e.message : '清理运行日志失败')
    } finally { setBusy('') }
  }

  async function reveal(kind: 'data' | 'logs' | 'models' | 'updates') {
    setNote('')
    try {
      await api.revealStorage(kind)
    } catch (e) {
      setNote(e instanceof Error ? e.message : '打不开目录')
    }
  }

  async function resetAll() {
    if (!window.confirm('恢复所有设置到默认值？会重置主题、推理参数、下载行为、更新开关与联网授权；模型、会话和记忆不会删除。')) return
    setBusy('reset')
    setNote('')
    try {
      const next = await api.resetSettings()
      onReset(next)
      setNote('设置已恢复默认；内置推理参数在下次启动模型时生效。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '恢复默认设置失败')
    } finally { setBusy('') }
  }

  const free = overview && overview.freeBytes > 0 ? formatBytes(overview.freeBytes) : '—'

  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">数据目录</div>
            <div className="setting-desc">会话、界面偏好、日志与默认模型目录都在这里；模型可以单独换到别的盘。</div>
          </div>
          <div className="settings-row-end">
            <code className="settings-path">{overview?.dataRoot || '%APPDATA%\\ModelDock'}</code>
            <button type="button" className="btn ghost sm" onClick={() => void reveal('data')}><FolderOpen />打开</button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">模型下载目录</div>
            <div className="setting-desc">新下载的 GGUF 会写到这里，「我的模型」也只扫描这里。切换不会移动已有文件。</div>
          </div>
          <span className={`chip ${directory?.custom ? 'success' : ''}`}>{directory?.custom ? '自定义' : '默认'}</span>
        </div>

        <div className="setting-row">
          <div className="settings-dir-form">
            <input
              className="settings-input"
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder={directory?.default || '%APPDATA%\\ModelDock\\models'}
              aria-label="模型下载目录"
              spellCheck={false}
            />
            <button type="button" className="btn primary sm" disabled={busy === 'directory' || !path.trim()} onClick={() => void save()}>
              <Check />{busy === 'directory' ? '保存中…' : '保存'}
            </button>
            <button type="button" className="btn ghost sm" disabled={busy === 'directory' || !directory?.custom} onClick={() => void save(true)}>
              恢复默认
            </button>
            <button type="button" className="btn ghost sm" onClick={() => void reveal('models')}><FolderOpen />打开</button>
          </div>
        </div>

        {(overview || directory) && (
          <div className="settings-stat-grid">
            <div className="settings-stat"><span>模型占用</span><strong>{formatBytes(overview?.modelBytes ?? 0)}</strong></div>
            <div className="settings-stat"><span>更新缓存</span><strong>{formatBytes(overview?.updatesBytes ?? 0)}</strong></div>
            <div className="settings-stat"><span>运行日志</span><strong>{formatBytes(overview?.logsBytes ?? 0)}</strong></div>
            <div className="settings-stat"><span>模型盘剩余</span><strong>{free}</strong></div>
          </div>
        )}

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">日志目录</div>
            <div className="setting-desc">更新日志、内置推理日志与审计日志；清空只删 <code>*.log</code>。</div>
          </div>
          <div className="settings-row-end">
            <code className="settings-path">{overview?.logsDirectory || '%APPDATA%\\ModelDock\\logs'}</code>
            <button type="button" className="btn ghost sm" onClick={() => void reveal('logs')}><FolderOpen />打开</button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">清理更新缓存</div>
            <div className="setting-desc">删除已下载的安装包、增量包与检查缓存，释放磁盘空间；不会动模型、会话和设置。</div>
          </div>
          <button type="button" className="btn ghost sm" disabled={busy === 'updates'} onClick={() => void cleanupUpdates()}>
            <Trash2 />{busy === 'updates' ? '清理中…' : '清理'}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">清理运行日志</div>
            <div className="setting-desc">删除 logs 目录下的 *.log；正在写入的文件会跳过，关掉应用后可再清一次。</div>
          </div>
          <button type="button" className="btn ghost sm" disabled={busy === 'logs'} onClick={() => void cleanupLogs()}>
            <Trash2 />{busy === 'logs' ? '清理中…' : '清理'}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">更新包目录</div>
            <div className="setting-desc">安装包和增量包先落在这里，校验通过后才执行安装。</div>
          </div>
          <div className="settings-row-end">
            <code className="settings-path">{overview?.updatesDirectory || '%APPDATA%\\ModelDock\\updates'}</code>
            <button type="button" className="btn ghost sm" onClick={() => void reveal('updates')}><FolderOpen />打开</button>
          </div>
        </div>

        {overview?.error && <div className="settings-callout">{overview.error}</div>}
        {note && <div className="settings-note" style={{ paddingLeft: 0 }}>{note}</div>}
      </section>

      <DownloadBehaviorSettings settings={settings} onChange={onChange} />

      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">恢复默认设置</div>
            <div className="setting-desc">所有界面与行为偏好回到安装时默认；模型、会话、记忆和已下载文件都不动。</div>
          </div>
          <button type="button" className="btn ghost sm settings-danger" disabled={busy === 'reset'} onClick={() => void resetAll()}>
            <RotateCcw />{busy === 'reset' ? '恢复中…' : '恢复默认'}
          </button>
        </div>
        <div className="settings-callout">恢复默认会重写 <code>%APPDATA%\ModelDock</code> 下的偏好文件；不会改版本、不会触发更新。</div>
      </section>

      <p className="settings-note">
        填绝对路径后保存，例如 <code>D:\Models\ModelDock</code>。已有模型不会自动搬迁；下载进行中不能切换目录。
        旧目录里的文件仍留在原处，需要时手动移动过来再回到「我的模型」刷新。
      </p>
    </>
  )
}

/* ── 日志与诊断 ───────────────────────────────────────────────────── */

function DiagnosticSettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const [status, setStatus] = useState<DiagnosticLogStatus | null>(null)
  const [tail, setTail] = useState('')
  const [days, setDays] = useState(String(settings.diagnosticLogDays))
  const [size, setSize] = useState(String(settings.diagnosticLogSizeMb))
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => { setDays(String(settings.diagnosticLogDays)) }, [settings.diagnosticLogDays])
  useEffect(() => { setSize(String(settings.diagnosticLogSizeMb)) }, [settings.diagnosticLogSizeMb])

  useEffect(() => {
    let alive = true
    const load = () => {
      void api.diagnostics().then(next => {
        if (alive) setStatus(next)
      }).catch(() => { /* 状态读不到不影响开关本身 */ })
    }
    load()
    const timer = window.setInterval(load, 8000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [settings.diagnosticLogEnabled, settings.diagnosticLogMode, settings.diagnosticLogDays, settings.diagnosticLogSizeMb])

  useEffect(() => {
    let alive = true
    void api.diagnosticsTail(200).then(result => {
      if (!alive) return
      setTail(result.text)
      setStatus(result.status)
    }).catch(() => { /* 预览失败时留空，用户可手动刷新 */ })
    return () => { alive = false }
  }, [])

  async function refreshPreview() {
    setBusy('preview')
    setNote('')
    try {
      const result = await api.diagnosticsTail(200)
      setTail(result.text)
      setStatus(result.status)
      setNote(result.text.trim() ? '' : '还没有日志写入。打开上面的开关，再发一条消息或重启一次应用。')
    } catch (e) {
      setNote(e instanceof Error ? e.message : '读取日志失败')
    } finally { setBusy('') }
  }

  async function cleanup() {
    if (!window.confirm('清空诊断日志？会删除 logs/app 与 logs/chat 下的文件，不影响更新日志、模型和会话。')) return
    setBusy('clear')
    setNote('')
    try {
      const result = await api.cleanupDiagnostics()
      setTail('')
      setNote(result.failed.length > 0
        ? `已删除 ${result.removed} 个日志、释放 ${formatBytes(result.freedBytes)}；${result.failed.join('；')}`
        : `已删除 ${result.removed} 个诊断日志，释放 ${formatBytes(result.freedBytes)}。`)
      setStatus(await api.diagnostics().catch(() => status))
    } catch (e) {
      setNote(e instanceof Error ? e.message : '清空诊断日志失败')
    } finally { setBusy('') }
  }

  async function reveal() {
    setNote('')
    try { await api.revealStorage('logs') }
    catch (e) { setNote(e instanceof Error ? e.message : '打不开日志目录') }
  }

  async function copy() {
    if (!tail.trim()) { setNote('当前没有可复制的日志。'); return }
    try {
      await navigator.clipboard.writeText(tail)
      setNote('已复制最近 200 行日志。')
    } catch {
      setNote('复制失败；可以打开日志目录直接取文件。')
    }
  }

  function applyDays() {
    const value = Number(days)
    onChange({ diagnosticLogDays: Number.isFinite(value) ? Math.max(1, Math.min(365, Math.trunc(value))) : 7 })
  }

  function applySize() {
    const value = Number(size)
    onChange({ diagnosticLogSizeMb: Number.isFinite(value) ? Math.max(5, Math.min(2000, Math.trunc(value))) : 100 })
  }

  const appLine = status?.currentAppFile ? status.currentAppFile.split(/[\\/]/).pop() : ''
  const chatLine = status?.currentChatFile ? status.currentChatFile.split(/[\\/]/).pop() : ''
  const previewLines = tail.split(/\r?\n/).filter(Boolean).slice(-200)

  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">本地诊断日志</div>
            <div className="setting-desc">
              打开后实时记录启动、更新、模型加载、对话、Agent 工具调用与异常。日志只写本机，不上传；
              对话正文可能包含你的提问与回复，请按需开启。
            </div>
          </div>
          <Toggle
            checked={settings.diagnosticLogEnabled}
            label="本地诊断日志"
            onChange={next => onChange({ diagnosticLogEnabled: next })}
          />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">保留方式</div>
            <div className="setting-desc">超过阈值后从最旧的文件开始删除；正在写入的应用日志与当前会话日志不会被删。</div>
          </div>
          <div className="segmented" role="group" aria-label="日志保留方式">
            <button type="button" className={settings.diagnosticLogMode === 'days' ? 'active' : ''} onClick={() => onChange({ diagnosticLogMode: 'days' })}>按天数</button>
            <button type="button" className={settings.diagnosticLogMode === 'size' ? 'active' : ''} onClick={() => onChange({ diagnosticLogMode: 'size' })}>按总量</button>
          </div>
        </div>

        {settings.diagnosticLogMode === 'days' ? (
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">保留天数</div>
              <div className="setting-desc">1–365 天。按文件最后写入时间计算，过期文件会在下一次检查时删除。</div>
            </div>
            <div className="settings-number-group">
              <input
                className="settings-input settings-number"
                type="number"
                min={1}
                max={365}
                value={days}
                aria-label="日志保留天数"
                onChange={e => setDays(e.target.value)}
                onBlur={applyDays}
              />
              <span className="settings-unit">天</span>
            </div>
          </div>
        ) : (
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">总大小上限</div>
              <div className="setting-desc">5–2000 MB。应用日志与对话日志共用这一份预算，从最旧文件开始删。</div>
            </div>
            <div className="settings-number-group">
              <input
                className="settings-input settings-number"
                type="number"
                min={5}
                max={2000}
                value={size}
                aria-label="日志总大小上限"
                onChange={e => setSize(e.target.value)}
                onBlur={applySize}
              />
              <span className="settings-unit">MB</span>
            </div>
          </div>
        )}

        {status && (
          <>
            <div className="settings-stat-grid">
              <div className="settings-stat"><span>诊断日志占用</span><strong>{formatBytes(status.totalBytes)}</strong></div>
              <div className="settings-stat"><span>系统流</span><strong>{status.appFiles} 个 · {formatBytes(status.appBytes)}</strong></div>
              <div className="settings-stat"><span>对话流</span><strong>{status.chatFiles} 个 · {formatBytes(status.chatBytes)}</strong></div>
              <div className="settings-stat"><span>最近写入</span><strong>{status.lastWriteAt ? new Date(status.lastWriteAt).toLocaleString() : '—'}</strong></div>
            </div>
            {(appLine || chatLine) && (
              <div className="settings-callout">
                当前写入：{appLine || '无应用日志'}{chatLine ? ` · ${chatLine}` : ''}
                {status.lastError ? ` · ${status.lastError}` : ''}
              </div>
            )}
          </>
        )}

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">日志目录</div>
            <div className="setting-desc">系统事件写 <code>logs/app</code>，对话与工具调用写 <code>logs/chat</code>；按会话分文件，便于定位。</div>
          </div>
          <div className="settings-row-end">
            <code className="settings-path">{status?.directory || '%APPDATA%\\ModelDock\\logs'}</code>
            <button type="button" className="btn ghost sm" onClick={() => void reveal()}><FolderOpen />打开</button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">最近 200 行</div>
            <div className="setting-desc">把 app 与 chat 两路日志按文件时间拼在一起预览；不会把完整对话推给界面之外。</div>
          </div>
          <div className="settings-row-end">
            <button type="button" className="btn ghost sm" disabled={busy === 'preview'} onClick={() => void refreshPreview()}>
              <RefreshCw />{busy === 'preview' ? '刷新中…' : '刷新'}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => void copy()}><Copy />复制</button>
            <button type="button" className="btn ghost sm settings-danger" disabled={busy === 'clear'} onClick={() => void cleanup()}>
              <Trash2 />{busy === 'clear' ? '清理中…' : '清空'}
            </button>
          </div>
        </div>

        <pre className="settings-log-view" aria-label="最近诊断日志">
          {previewLines.length > 0 ? previewLines.map((line, index) => (
            <span key={index} className="settings-log-line">{prettyLogLine(line)}</span>
          )) : <span className="settings-log-empty">{settings.diagnosticLogEnabled ? '暂无日志写入，发一条消息或重启应用后会出现。' : '诊断日志当前关闭。打开开关后，新的启动、更新、模型与对话事件才会落盘。'}</span>}
        </pre>

        {note && <div className="settings-note" style={{ paddingLeft: 0 }}>{note}</div>}
        <div className="settings-callout">
          默认关闭；开启后按当前阈值自动清理。日志用于排障，不参与云同步，也不会随会话记忆一起清空。
        </div>
      </section>
    </>
  )
}

function prettyLogLine(line: string): string {
  try {
    const row = JSON.parse(line) as { ts?: string; level?: string; cat?: string; msg?: string; process?: string; data?: unknown }
    const time = row.ts ? new Date(row.ts).toLocaleTimeString() : ''
    const level = (row.level || 'info').toUpperCase().padEnd(5)
    const process = row.process === 'chat' ? '对话' : '应用'
    const data = row.data ? ` · ${JSON.stringify(row.data).slice(0, 260)}` : ''
    return `${time} ${level} [${process}/${row.cat || '-'}] ${row.msg || ''}${data}`
  } catch {
    return line
  }
}

/* ── Agent 与联网 ───────────────────────────────────────────────────── */

function AgentSettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const [memory, setMemory] = useState<AgentMemoryInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  function loadMemory() {
    void agentApi.memory().then(setMemory).catch(() => setNote('读取记忆失败，稍后重试。'))
  }
  useEffect(loadMemory, [])

  async function clearAll() {
    if (!window.confirm('清空当前工作目录的会话记忆与备忘？审计日志和项目经验（.tianshu/lessons.md）不会删除。')) return
    setBusy(true)
    setNote('')
    try {
      const result = await agentApi.clearMemory()
      setNote(result.failed.length > 0
        ? `已清空 ${result.sessions} 份会话记忆、${result.noteFiles} 份备忘；部分文件删不掉：${result.failed.join('；')}`
        : `已清空 ${result.sessions} 份会话记忆、${result.noteFiles} 份备忘。`)
      loadMemory()
    } catch (e) {
      setNote(e instanceof Error ? e.message : '清空记忆失败')
    } finally { setBusy(false) }
  }

  const workspaceNotes = memory?.notes.workspace.length ?? 0
  const globalNotes = memory?.notes.global.length ?? 0
  const sessions = memory?.sessions.length ?? 0

  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">允许代理联网读取网页</div>
            <div className="setting-desc">
              默认关闭。打开后，代理派出的 searcher 子体可以用 web_fetch 读公开网页的正文与链接（不提交表单、不登录、不下载文件、不带 cookie）；主代理本身仍然没有联网工具，要上网必须派子体，这样范围、次数与超时都落在一个只读、有预算、可随时停止的任务上。
              关闭时 web_fetch 会被直接拒绝，一个请求都不会发出去。
            </div>
          </div>
          <Toggle
            checked={settings.agentNetwork}
            label="允许代理联网读取网页"
            onChange={next => onChange({ agentNetwork: next })}
          />
        </div>
      </section>

      <section className="settings-card settings-detail-card">
        <div className="sources-head">
          <div>
            <div className="setting-name">本机记忆</div>
            <div className="setting-desc">当前工作目录：<code>{memory?.workspace || '%APPDATA%\\ModelDock\\workspace'}</code></div>
          </div>
          <span className="chip">{sessions} 份会话记忆</span>
        </div>
        <div className="settings-stat-grid settings-stat-grid-three">
          <div className="settings-stat"><span>会话记忆</span><strong>{sessions}</strong></div>
          <div className="settings-stat"><span>工作目录备忘</span><strong>{workspaceNotes}</strong></div>
          <div className="settings-stat"><span>全局备忘</span><strong>{globalNotes}</strong></div>
        </div>
        <div className="settings-actions">
          <button type="button" className="btn ghost sm settings-danger" disabled={busy} onClick={() => void clearAll()}>
            <Trash2 />{busy ? '清空中…' : '清空记忆'}
          </button>
          <button type="button" className="btn ghost sm" onClick={loadMemory}><RefreshCw />刷新</button>
        </div>
        <div className="settings-callout">
          清空范围：会话记忆文件、当前工作目录备忘、全局备忘。审计日志（agent-audit.jsonl）与项目经验（<code>.tianshu/lessons.md</code>）保留；这两个不是记忆，不能跟着按钮一起消失。
        </div>
        {note && <div className="settings-note" style={{ paddingLeft: 0 }}>{note}</div>}
      </section>
    </>
  )
}

/* ── 更新与公告 ─────────────────────────────────────────────────────── */

function formatClock(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function VersionUpdateSettings({ settings, onChange, onOpenReleaseNotes }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onOpenReleaseNotes: () => void
}) {
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null)
  const [skippedVersion, setSkippedVersion] = useState(() => {
    try { return localStorage.getItem('stardock.update.skipped') ?? '' } catch { return '' }
  })
  const { download, busy, installing, blocked, portableBlocked, start, pause, install, reveal, percent } = useUpdateDownload((text) => showNotice(text, 'error'))
  const [confirming, setConfirming] = useState(false)
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'
  const paused = download?.state === 'paused'
  const ready = download?.state === 'ready'
  const runtimeVersion = getRuntimeVersion()
  const shownVersion = runtimeVersion || APP_VERSION
  const versionMismatch = !!runtimeVersion && runtimeVersion !== APP_VERSION

  useEffect(() => {
    let alive = true
    void api.updateResult().then(next => { if (alive) setOutcome(next) }).catch(() => { /* 没有记录就保持空 */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setChecking(true)
    void api.checkUpdate(false).then(next => {
      if (!alive) return
      setCheck(next)
      if (next.error) setError(next.error)
    }).catch((e: unknown) => {
      if (alive) setError(e instanceof Error ? e.message : '检查更新失败')
    }).finally(() => {
      if (alive) setChecking(false)
    })
    return () => { alive = false }
  }, [])

  const [stepBack, setStepBack] = useState('')
  async function switchChannel() {
    const next = settings.updateChannel === 'beta' ? 'stable' : 'beta'
    onChange({ updateChannel: next })
    setStepBack('')
    const saved = await api.saveSettings({ ...settings, updateChannel: next }).catch(() => null)
    const result = await runCheck()
    if (saved && result && next === 'stable' && APP_VERSION.includes('-') &&
        !result.available && !result.error && result.latestVersion) {
      setStepBack(result.latestVersion)
    }
  }

  async function confirmStepBack() {
    const version = stepBack
    setStepBack('')
    setChecking(true)
    try {
      const { ok } = await api.allowUpdateStepBack(version)
      if (!ok) {
        setError('没能换回正式版：当前不是测试版，或者目标不是更低的正式版。')
        return
      }
      await runCheck()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally { setChecking(false) }
  }

  function showNotice(text: string, tone: 'info' | 'error' = 'info') {
    setNoticeTone(tone)
    setNotice(text)
  }

  async function runCheck(): Promise<UpdateCheck | null> {
    setChecking(true)
    setError('')
    setNotice('')
    try {
      const next = await api.checkUpdate(true)
      setCheck(next)
      if (next.error) {
        setError(next.error)
      } else if (next.downgrade) {
        showNotice(`可以换回正式版 v${next.latestVersion}（比当前的测试版低），可以开始下载。`)
      } else if (next.available) {
        showNotice(`发现新版本 v${next.latestVersion}${next.forced ? '（必须升级）' : ''}，可以开始下载。`)
      } else if (next.rolloutPending) {
        showNotice(`v${next.latestVersion} 正在灰度发布（当前覆盖 ${next.rolloutPercent}%），还没轮到这台，放量后会自动提示。`)
      } else {
        showNotice(`已是最新版本 v${next.currentVersion}（${formatClock(next.checkedAt)} 完成检查）`)
      }
      return next
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查更新失败')
      return null
    } finally { setChecking(false) }
  }

  function openExternal(url: string) {
    if (!url) return
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_url', { url }))
      .catch(() => { window.open(url, '_blank', 'noreferrer') })
  }

  function openDownloadUrl() {
    const url = check?.asset?.url || check?.releaseUrl || ''
    if (!url) {
      showNotice('没有可打开的下载地址，请稍后再检查。', 'error')
      return
    }
    openExternal(url)
  }

  async function copyDownloadUrl() {
    const url = check?.asset?.url
    if (!url) {
      showNotice('没有可复制的安装包直链，请用「在 GitHub 查看」。', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      showNotice('下载直链已复制到剪贴板。')
    } catch {
      showNotice('复制失败，请用「用浏览器下载」。', 'error')
    }
  }

  async function copyDiagnostics() {
    setError('')
    setNotice('')
    try {
      const payload = await api.updateDiagnostics()
      const text = payload.text?.trim()
      if (!text) { showNotice('还没有更新记录：触发一次检查后再来复制。'); return }
      await navigator.clipboard.writeText(`${payload.channel}\n${payload.logPath}\n\n${text}`)
      showNotice('更新日志已复制到剪贴板。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取更新日志失败')
    }
  }

  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">启动时自动检查更新</div>
            <div className="setting-desc">打开应用后读取公开仓库的最新 Release，发现新版本才提示；关闭后应用不会主动请求 GitHub。</div>
          </div>
          <Toggle checked={settings.autoCheckUpdate} label="启动时自动检查更新" onChange={next => onChange({ autoCheckUpdate: next })} />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">发现新版本时自动下载</div>
            <div className="setting-desc">默认开启：在应用运行时就把安装包下好并校验，你只需要在方便的时候重启完成升级；关闭后改为手动点“下载”。</div>
          </div>
          <Toggle checked={settings.autoDownloadUpdate} label="发现新版本时自动下载" onChange={next => onChange({ autoDownloadUpdate: next })} />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">优先使用增量更新</div>
            <div className="setting-desc">默认开启：升级时只下载改动过的文件（约几 MB），在退出后覆盖并校验；增量不可用或还原失败会自动改用完整安装包。</div>
          </div>
          <Toggle checked={settings.deltaUpdate} label="优先使用增量更新" onChange={next => onChange({ deltaUpdate: next })} />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">接收测试版更新</div>
            <div className="setting-desc">
              {settings.updateChannel === 'beta'
                ? '已开启：检测测试版和正式版里最高的那个。关掉就只检测正式版；如果正式版比当前的测试版低，会问一次是否换回。'
                : '已关闭：只检测正式版。开启后会检测到版本号带 beta 的测试版，可能不够稳定。切换后立即重新检查。'}
            </div>
          </div>
          <Toggle checked={settings.updateChannel === 'beta'} label="接收测试版更新" onChange={() => void switchChannel()} />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">退出应用时自动安装</div>
            <div className="setting-desc">默认开启：安装包已下好并校验通过时，从托盘菜单“退出”会先装完再退出，下次打开就是新版；关闭后只在点“重启并升级”时安装。</div>
          </div>
          <Toggle checked={settings.autoInstallOnQuit} label="退出应用时自动安装" onChange={next => onChange({ autoInstallOnQuit: next })} />
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">更新诊断</div>
            <div className="setting-desc">复制最近的检查、下载与安装记录；日志只写版本与状态，下载地址只保留域名。</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => void copyDiagnostics()}>
            <FileText aria-hidden />复制日志
          </button>
        </div>

        {outcome && (
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">上次更新{outcome.ok ? '已完成' : '未完成'}</div>
              <div className="setting-desc">
                {outcome.ok
                  ? `已升级到 v${outcome.version}（${formatReleaseDate(outcome.at)}）。`
                  : `升级到 v${outcome.version} 没有生效：${outcome.reason}`}
              </div>
            </div>
            {outcome.ok
              ? <span className="chip">成功</span>
              : <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void start()}>重新下载</button>}
          </div>
        )}

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">当前版本 v{shownVersion}</div>
            <div className="setting-desc">
              检查对象是公开仓库的 releases/latest；只读取版本号、公告与资产列表，不上报本机信息。
              {check?.forced && check.available ? ' 这一版是最低版本要求，必须升级后继续使用。' : ''}
            </div>
          </div>
          <button type="button" className="btn ghost sm" disabled={checking} onClick={() => void runCheck()}>
            <RefreshCw aria-hidden />{checking ? '检查中…' : '立即检查'}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name"><Megaphone aria-hidden size={14} /> 版本更新公告</div>
            <div className="setting-desc">查看本版修复说明与历史版本记录。公告随安装包离线保存，不依赖联网加载。</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={onOpenReleaseNotes}>
            查看公告<ChevronRight aria-hidden size={14} />
          </button>
        </div>

        {skippedVersion && (
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">已忽略 v{skippedVersion}</div>
              <div className="setting-desc">这一版不会再弹更新横幅。清除后，下次检查会重新提示。</div>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                try {
                  localStorage.removeItem('stardock.update.skipped')
                  localStorage.removeItem('stardock.update.snooze')
                } catch { /* 隐私模式忽略 */ }
                setSkippedVersion('')
                showNotice('已清除忽略记录，下次检查会重新提示这一版')
              }}
            >
              <Trash2 aria-hidden />清除
            </button>
          </div>
        )}
      </section>

      {versionMismatch && (
        <div className="settings-callout update-error-line">
          <AlertCircle size={14} aria-hidden />
          界面组件 v{APP_VERSION} 与后台内核 v{runtimeVersion} 不一致，安装可能不完整。请下载完整安装包覆盖安装，避免增量补丁对不上。
        </div>
      )}

      {error && (
        <div className="settings-callout update-error-line">
          <AlertCircle size={14} aria-hidden />{error}
        </div>
      )}

      {notice && (
        <div className={`settings-callout ${noticeTone === 'error' ? 'update-error-line' : 'update-notice-line'}`}>
          {noticeTone === 'error' ? <AlertCircle size={14} aria-hidden /> : <Check size={14} aria-hidden />}
          {notice}
        </div>
      )}

      {!check && checking && (
        <section className="settings-card settings-detail-card">
          <div className="update-latest"><RefreshCw className="spin" size={16} aria-hidden />正在读取公开仓库的 Release…</div>
        </section>
      )}

      {stepBack && (
        <section className="settings-card settings-detail-card">
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">换回正式版 v{stepBack}？</div>
              <div className="setting-desc">
                它比当前的测试版 v{APP_VERSION} 低。换回会安装这个正式版并需要重启一次，用的是完整安装包，免安装版需要手动下载正式版覆盖。
                不换就留在当前版本，不会再自动提示，除非重新切换上面的开关。
              </div>
            </div>
            <button type="button" className="btn primary sm" disabled={checking} onClick={() => void confirmStepBack()}>
              换回正式版
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setStepBack('')}>
              留在当前版本
            </button>
          </div>
        </section>
      )}

      {check && check.available && (
        <section className="settings-card settings-detail-card update-result">
          <div className="update-result-head">
            <div>
              <div className="setting-name">
                {check.downgrade
                  ? `换回正式版 v${check.latestVersion}`
                  : `发现新版本 v${check.latestVersion}${check.latestVersion.includes('-') ? ' · 测试版' : ''}`}
              </div>
              <div className="setting-desc">
                {releaseNameLabel(check.releaseName, check.latestVersion, check.publishedAt)}
              </div>
            </div>
            <span className="chip accent">可更新</span>
          </div>

          {check.notes && (
            <div className="update-notes">
              {noteLines(check.notes).map((line, index) => line.kind === 'sub'
                ? <div className="update-notes-sub" key={index}>{line.text}</div>
                : line.kind === 'item'
                  ? <div className="update-notes-item" key={index}>{line.text}</div>
                  : <div className="update-notes-text" key={index}>{line.text}</div>)}
            </div>
          )}

          <div className="update-asset">
            <div className="update-asset-copy">
              <div className="update-asset-name">{check.asset?.name ?? '这个版本没有可下载的安装包'}</div>
              <div className="update-asset-meta">
                {check.asset ? formatBytes(check.asset.size) : '只有源码或没有资产'}
                {ready && download?.verified ? ' · 已通过 SHA256 校验' : ''}
                {ready && download && !download.verified ? ' · 未取得校验值' : ''}
              </div>
            </div>
            <div className="update-asset-actions">
              {ready && blocked ? (
                <>
                  {portableBlocked && (
                    <button type="button" className="btn primary sm" disabled={busy} onClick={() => void install(true)}>
                      <RefreshCw aria-hidden />重试增量升级
                    </button>
                  )}
                  <button type="button" className={portableBlocked ? 'btn ghost sm' : 'btn primary sm'} onClick={() => void reveal()}>
                    <FolderOpen aria-hidden />打开文件夹手动装
                  </button>
                </>
              ) : ready ? (
                <>
                  <button type="button" className="btn primary sm" disabled={busy} onClick={() => setConfirming(true)}>
                    <Check aria-hidden />重启并升级
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => void reveal()}>
                    <FolderOpen aria-hidden />打开文件夹
                  </button>
                </>
              ) : paused ? (
                <button type="button" className="btn primary sm" disabled={busy} onClick={() => void start()}>
                  <Download aria-hidden />继续下载
                </button>
              ) : (
                <>
                  <button type="button" className="btn primary sm" disabled={busy || downloading || !check.asset} onClick={() => void start()}>
                    <Download aria-hidden />{downloading ? '下载中…' : download?.state === 'failed' ? '重新下载' : '开始下载'}
                  </button>
                  {download?.state === 'failed' && (
                    <>
                      <button type="button" className="btn ghost sm" onClick={openDownloadUrl}>
                        <ExternalLink aria-hidden />用浏览器下载
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => void copyDownloadUrl()}>
                        <Copy aria-hidden />复制直链
                      </button>
                    </>
                  )}
                  {downloading && (
                    <button type="button" className="btn ghost sm" onClick={() => void pause()}>暂停</button>
                  )}
                </>
              )}
            </div>
          </div>

          {blocked && <div className="update-inline-error">{blocked}</div>}

          {downloading && (
            <div className="update-progress">
              <div className="update-progress-bar"><span style={{ width: `${percent}%` }} /></div>
              <div className="update-progress-note">
                {download?.state === 'verifying'
                  ? '正在校验 SHA256…'
                  : download?.stage === 'connect'
                    ? `正在连接${download?.sourceHost ? ` ${download.sourceHost}${download.sourceCount && download.sourceCount > 1 ? `（第 ${download.sourceIndex}/${download.sourceCount} 个源）` : ''}` : '下载地址'}…`
                    : download?.receivedBytes
                      ? `正在下载 ${percent}% · ${formatBytes(download?.receivedBytes ?? 0)}${download?.sourceHost ? ` · 源 ${download.sourceHost}` : ''}`
                      : '正在连接下载地址…'}
              </div>
            </div>
          )}

          {download?.state === 'failed' && download.error && (
            <div className="update-inline-error">{download.error}</div>
          )}

          {ready && download && !download.verified && (
            <div className="settings-callout">
              没有完成 SHA256SUMS.txt 校验：{download.checksumError || '校验文件不可用'}。不会执行应用内升级；请在下载目录自行确认后再运行。
            </div>
          )}

          {installing && (
            <div className="settings-callout">
              正在安装 v{download?.version}。系统弹出权限确认时请选择“是”；确认后应用会自动关闭，装完再自动打开。如果权限确认被拒绝，升级会取消，当前版本可以继续使用。
            </div>
          )}

          {confirming && !installing && !blocked && (
            <div className="update-confirm">
              <div className="update-confirm-text">
                升级会关闭当前窗口，并中断正在进行的模型下载（升级后可断点续传）。安装过程会弹一次系统权限确认。
              </div>
              <div className="update-confirm-actions">
                <button type="button" className="btn primary sm" disabled={busy} onClick={() => void install(settings.deltaUpdate)}>
                  <Check aria-hidden />确认重启
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>再等等</button>
              </div>
            </div>
          )}

          <div className="update-foot">
            <button type="button" className="btn ghost sm" onClick={() => openExternal(check.releaseUrl)}>
              <ExternalLink aria-hidden />在 GitHub 查看
            </button>
            <span className="update-foot-note">只打开公开仓库的 Release 页面</span>
          </div>
        </section>
      )}

      {check && !check.available && !check.error && (
        <section className="settings-card settings-detail-card">
          <div className="update-latest">
            <Check size={16} aria-hidden />已是最新版本 v{check.currentVersion}
            <span className="update-latest-note">
              公开仓库最新为 v{check.latestVersion || check.currentVersion} · {formatClock(check.checkedAt)} 检查
            </span>
          </div>
        </section>
      )}

      <div className="settings-callout">
        版本检查只请求公开仓库 <strong>modeldock-ui</strong> 的 Release 接口；不带令牌、不上报设备信息。安装包下载到
        %APPDATA%\ModelDock\updates，校验通过后才会执行应用内安装。自动检查与自动下载默认开启，可在此页关闭。绿色包（免安装版）不支持应用内升级。
        更新缓存的清理已放到「存储与数据」，避免更新页同时承担维护动作。
      </div>
    </>
  )
}

/* ── 关于与公告 ─────────────────────────────────────────────────────── */

function AboutSettings({ onReplayTour }: { onReplayTour: () => void }) {
  return (
    <section className="settings-card settings-detail-card">
      <div className="about-hero">
        <div className="about-mark"><BrandMark size={60} /></div>
        <div>
          <div className="about-name">天枢</div>
          <div className="about-sub">v{APP_VERSION} · Tauri 2 + React · Miuix 设计规范</div>
        </div>
      </div>
      <div className="about-facts">
        <div className="about-fact"><span>应用框架</span><strong>Tauri 2 + React</strong></div>
        <div className="about-fact"><span>设计规范</span><strong>Miuix 蓝 #3482FF · 16dp 圆角</strong></div>
        <div className="about-fact"><span>窗口材质</span><strong>默认亚克力 · 云母原生色调 · 纯色不透明</strong></div>
        <div className="about-fact"><span>数据存储</span><strong>模型、会话与偏好均保存在本机</strong></div>
        <div className="about-fact"><span>前端许可</span><strong>公开库 modeldock-ui；许可见仓库 LICENSE</strong></div>
        <div className="about-fact">
          <span>上手指引</span>
          <span>
            <button type="button" className="btn ghost sm" onClick={onReplayTour}><Compass />重新查看</button>
          </span>
        </div>
      </div>
      <p className="about-note">启动页与启动动画于 v3.5.0 加入；首次启动将播放六步上手指引（欢迎、四个功能入口与收尾），之后可从此页重新查看。</p>
    </section>
  )
}

function releaseCount(item: ReleaseHistoryItem) {
  return item.sections.reduce((sum, section) => sum + section.items.length, 0)
}

function sectionTone(title: string) {
  if (title === '新增') return 'new'
  if (title === '变更') return 'change'
  if (title === '修复') return 'fix'
  if (title === '优化') return 'opt'
  return 'other'
}

function ReleaseSections({ sections }: { sections: ReleaseNoteSection[] }) {
  if (sections.length === 0) {
    return <p className="release-empty">这一版没有留下可读条目。</p>
  }
  return (
    <div className="release-sections">
      {sections.map((section, sectionIndex) => (
        <section className="release-section" key={`${section.title}-${sectionIndex}`}>
          <div className="release-section-head">
            <span className={`release-kind ${sectionTone(section.title)}`}>{section.title}</span>
            <span className="release-section-count">{section.items.length} 条</span>
          </div>
          <ul className="release-items">
            {section.items.map((item, itemIndex) => (
              <li key={`${item.title}-${itemIndex}`}>
                {item.title && <strong>{item.title}</strong>}
                {item.detail && <span>{item.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function UpdateSettings({ channel }: { channel: 'stable' | 'beta' }) {
  const history = channel === 'beta' ? releaseHistory : releaseHistoryStable
  const current = history.flatMap(group => group.items).find(item => item.version === APP_VERSION)
  const older = history
    .map(group => ({ ...group, items: group.items.filter(item => item.version !== APP_VERSION) }))
    .filter(group => group.items.length > 0)
  const historyCount = older.reduce((sum, group) => sum + group.items.length, 0)
  const currentCount = current ? releaseCount(current) : 0
  const runtimeVersion = getRuntimeVersion()
  const shownVersion = runtimeVersion || APP_VERSION
  const versionMismatch = !!runtimeVersion && runtimeVersion !== APP_VERSION

  return (
    <>
      {versionMismatch && (
        <div className="settings-callout update-error-line">
          <AlertCircle size={14} aria-hidden />
          界面组件 v{APP_VERSION} 与后台内核 v{runtimeVersion} 不一致，安装可能不完整。请下载完整安装包覆盖安装，避免增量补丁对不上。
        </div>
      )}
      <section className="settings-card release-current">
        <div className="release-current-head">
          <div className="release-current-top">
            <span className="release-latest"><Megaphone size={12} /> 当前版本</span>
            <span className="release-status">本地离线更新</span>
          </div>
          <div className="release-version">v{shownVersion}</div>
          <div className="release-hero-title">{current?.title ?? '版本公告'}</div>
          <div className="release-meta">
            {current ? `${current.date} · 当前版本` : '本版本暂无公告记录'}
          </div>
        </div>
        <div className="release-current-body">
          {current ? (
            <>
              <div className="release-body-head">
                <span className="release-body-label">本版更新</span>
                <span className="release-body-count">{currentCount} 条 · {current.sections.length} 个分类</span>
              </div>
              <ReleaseSections sections={current.sections} />
              <details className="release-overview">
                <summary className="release-overview-summary">
                  <span className="release-overview-title">当前版本功能概览</span>
                  <span className="release-overview-hint">当前版本已具备</span>
                  <ChevronDown className="release-overview-chevron" size={15} aria-hidden />
                </summary>
                <div className="release-overview-grid">
                  <div className="release-overview-block">
                    <h4>模型与下载</h4>
                    <ul>
                      <li>魔搭 / 魔搭国际 / Hugging Face / OpenCSG 四个来源独立开关</li>
                      <li>推荐与全部目录，多源结果实时去重</li>
                      <li>断点续传，源站 SHA256、体积与 GGUF 结构校验</li>
                      <li>按内存与显存评估本机运行条件</li>
                    </ul>
                  </div>
                  <div className="release-overview-block">
                    <h4>推理与对话</h4>
                    <ul>
                      <li>优先复用 Ollama，内置 llama.cpp 作为回退</li>
                      <li>支持 Edge0 本机服务，GGUF 模型加载与切换</li>
                      <li>流式输出、会话持久化与启动握手</li>
                    </ul>
                  </div>
                  <div className="release-overview-block">
                    <h4>外观与数据</h4>
                    <ul>
                      <li>启动页、六步上手指引与侧栏重播入口</li>
                      <li>Miuix 设计规范，浅色 / 深色 / 跟随系统</li>
                      <li>亚克力 / 云母 / 纯色材质与强调色</li>
                      <li>关闭主窗口收进系统托盘，左键恢复、右键菜单退出</li>
                      <li>访问凭据只保存在本机，不通过界面回传</li>
                    </ul>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <p className="release-empty">当前版本没有可展示的公告条目。</p>
          )}
        </div>
      </section>

      <section className="settings-card release-history-card">
        <div className="release-history-head">
          <span>历史版本</span>
          <span className="release-history-count">v1.0.0 起 · {historyCount} 个版本</span>
        </div>
        {older.map(group => (
          <details className="release-group" key={group.major}>
            <summary className="release-group-summary">
              <span className="release-group-label">{group.label}</span>
              <span className="release-group-range">{group.range}</span>
              <span className="release-group-count">{group.items.length} 个版本</span>
              <ChevronDown className="release-group-chevron" size={16} aria-hidden />
            </summary>
            <div className="release-group-list">
              {group.items.map(item => (
                <details className="release-past" key={item.version}>
                  <summary className="release-past-summary">
                    <span className="release-past-version">v{item.version}</span>
                    <span className="release-past-date">{item.date}</span>
                    <span className="release-past-title">{item.title}</span>
                    <span className="release-past-count">{releaseCount(item)} 条</span>
                    <ChevronDown className="release-past-chevron" size={15} aria-hidden />
                  </summary>
                  <div className="release-past-body">
                    <ReleaseSections sections={item.sections} />
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </section>

      <div className="settings-callout">
        更新公告随安装包离线发布；是否检查新版本在“更新与公告”分组里开关，默认启动时检查一次公开仓库的 Release。运行新版本安装包覆盖安装即可；模型、会话与偏好保存在本机数据目录。
      </div>
    </>
  )
}

/* ── 设置首页 ───────────────────────────────────────────────────────── */

type SearchEntry = { section: SettingsSection; group: string; title: string; keywords: string }

const searchIndex: SearchEntry[] = [
  { section: 'appearance', group: '外观与主题', title: '主题与深浅色', keywords: '主题 浅色 深色 跟随系统 外观' },
  { section: 'appearance', group: '外观与主题', title: '窗口材质', keywords: '材质 亚克力 云母 纯色 透明 壁纸' },
  { section: 'appearance', group: '外观与主题', title: '强调色', keywords: '强调色 颜色 配色 蓝' },
  { section: 'startup', group: '启动与窗口', title: '启动页动画', keywords: '启动页 动画 快速 完整 跳过' },
  { section: 'startup', group: '启动与窗口', title: '启动后打开', keywords: '启动 页面 模型库 对话 上次页面' },
  { section: 'startup', group: '启动与窗口', title: '关闭窗口时收进托盘', keywords: '托盘 关闭 退出 最小化 后台' },
  { section: 'startup', group: '启动与窗口', title: '开机自启与登录最小化', keywords: '开机 自启 启动 登录 注册表 Run 托盘' },
  { section: 'inference', group: '模型与推理', title: '推理后端', keywords: '后端 ollama edge0 内置 llama 自动' },
  { section: 'inference', group: '模型与推理', title: '硬件与显存', keywords: '处理器 cpu 内存 显卡 显存 预算 硬件' },
  { section: 'inference', group: '模型与推理', title: '显卡加速组件', keywords: 'gpu vulkan 加速 组件 安装 卸载' },
  { section: 'inference', group: '模型与推理', title: '上下文窗口与 GPU 层数', keywords: '上下文 窗口 context gpu 层数 线程 高级参数 显存' },
  { section: 'inference', group: '模型与推理', title: 'Edge0 连接', keywords: 'edge0 无界方舟 服务 地址 别名 权重' },
  { section: 'inference', group: '模型与推理', title: '模型来源', keywords: '模型来源 魔搭 modelscope huggingface opencsg token' },
  { section: 'storage', group: '存储与数据', title: '数据与模型目录', keywords: '目录 路径 数据 模型 换盘 磁盘 空间' },
  { section: 'storage', group: '存储与数据', title: '清理更新缓存', keywords: '清理 更新 缓存 安装包 增量包 空间' },
  { section: 'storage', group: '存储与数据', title: '清理运行日志', keywords: '日志 清理 log 审计' },
  { section: 'storage', group: '存储与数据', title: '同时下载数与限速', keywords: '下载 并发 限速 速度 kb mb 同时' },
  { section: 'storage', group: '存储与数据', title: '下载完成通知', keywords: '通知 下载完成 任务栏 提示' },
  { section: 'storage', group: '存储与数据', title: '恢复默认设置', keywords: '恢复 默认 重置 reset' },
  { section: 'agent', group: 'Agent 与联网', title: '代理联网读取网页', keywords: '联网 网页 web_fetch 代理 搜索 子体' },
  { section: 'agent', group: 'Agent 与联网', title: '本机记忆与清空', keywords: '记忆 备忘 会话 清空 memory' },
  { section: 'chat', group: '对话与输入', title: '发送快捷键', keywords: '发送 Enter Ctrl 回车 快捷键 换行' },
  { section: 'chat', group: '对话与输入', title: '对话字号', keywords: '字号 字体 大小 阅读 对话' },
  { section: 'chat', group: '对话与输入', title: '长行自动换行', keywords: '换行 代码 日志 横向滚动 长行' },
  { section: 'chat', group: '对话与输入', title: '默认 Agent 形态', keywords: '默认 形态 办公 编程 agent' },
  { section: 'fonts', group: '字体库', title: '对话阅读字体', keywords: '字体 字体库 阅读 系统字体 MiSans 宋体 黑体' },
  { section: 'fonts', group: '字体库', title: '搜索与下载字体', keywords: '字体 搜索 下载 预览 多语言 简体中文 日文 韩文 阿拉伯文' },
  { section: 'fonts', group: '字体库', title: '上传自己的字体', keywords: '上传 字体 ttf otf woff 自定义' },
  { section: 'update', group: '更新与公告', title: '自动检查与自动下载', keywords: '更新 检查 自动下载 升级' },
  { section: 'update', group: '更新与公告', title: '测试版通道', keywords: '测试版 beta 正式版 通道 灰度' },
  { section: 'update', group: '更新与公告', title: '增量更新与退出安装', keywords: '增量 delta 退出 安装 重启' },
  { section: 'update', group: '更新与公告', title: '更新诊断', keywords: '诊断 日志 复制 更新失败' },
  { section: 'diagnostics', group: '日志与诊断', title: '开启本地诊断日志', keywords: '日志 诊断 log 开启 关闭 实时 留存' },
  { section: 'diagnostics', group: '日志与诊断', title: '按天数或按总量保留', keywords: '日志 保留 天数 总大小 清理 自动删除' },
  { section: 'diagnostics', group: '日志与诊断', title: '日志占用与预览', keywords: '日志 占用 大小 文件 预览 最近 复制 清空' },
  { section: 'about', group: '关于', title: '关于天枢', keywords: '关于 版本 框架 许可 上手指引' },
  { section: 'updates', group: '更新与公告', title: '版本更新公告', keywords: '版本 更新 公告 release notes 历史 本版 修复说明 更新说明' },
]

export function SettingsPage({ settings, onChange, onReset, hardware, onReplayTour, jumpTo, onJumpHandled }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onReset: (next: AppSettings) => void
  hardware: HardwareProfile | null
  onReplayTour: () => void
  jumpTo?: { section: 'update' | 'updates'; id: number } | null
  onJumpHandled?: () => void
}) {
  const [section, setSection] = useState<SettingsSection | null>(null)
  const [sourceState, setSourceState] = useState<ModelSourcesState | null>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const accentLabel = accents.find(accent => accent.value === settings.accent)?.name ?? '自定义强调色'
  const cpuLabel = cleanCpuName(hardware?.cpuName)
  const inferenceSummary = hardware
    ? `${cpuLabel} · ${hardware.ramGb.toFixed(0)} GB · ${hardware.hasGpu ? hardware.gpuName : 'CPU 推理'}`
    : '正在读取设备信息'

  useEffect(() => {
    if (!jumpTo) return
    setSection(jumpTo.section)
    onJumpHandled?.()
  }, [jumpTo?.id])

  useEffect(() => {
    let alive = true
    void api.sources().then(state => {
      if (alive) setSourceState(state)
    }).catch(() => { /* 读不到就按来源页自己的提示处理，不影响其他设置 */ })
    return () => { alive = false }
  }, [])

  // Esc 回到设置首页；Ctrl+, 在设置内聚焦搜索框，已经是设置页时不再重复跳转。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && section) {
        setSection(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setSection(null)
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section])

  const groups: Array<{
    id: SettingsGroupId
    title: string
    summary: string
    icon: (props: { size?: number }) => ReactElement
  }> = [
    {
      id: 'appearance',
      title: '外观与主题',
      summary: '主题 · 窗口材质 · 强调色',
      icon: ThemeIcon,
    },
    {
      id: 'startup',
      title: '启动与窗口',
      summary: '启动动画 · 启动落点 · 关闭收进托盘 · 登录自启',
      icon: StartupIcon,
    },
    {
      id: 'inference',
      title: '模型与推理',
      summary: inferenceSummary,
      icon: ModelIcon,
    },
    {
      id: 'storage',
      title: '存储与数据',
      summary: '模型目录与占用 · 缓存清理 · 下载并发与限速',
      icon: StorageIcon,
    },
    {
      id: 'agent',
      title: 'Agent 与联网',
      summary: '联网读取 · 会话记忆 · 工作目录备忘 · 清空记忆',
      icon: AgentIcon,
    },
    {
      id: 'chat',
      title: '对话与输入',
      summary: '发送快捷键 · 对话字号 · 长行自动换行',
      icon: ChatIcon,
    },
    {
      id: 'fonts',
      title: '字体库',
      summary: '对话阅读区 · 多语言 / 多风格 · 上传与预览',
      icon: FontIcon,
    },
    {
      id: 'update',
      title: '更新与公告',
      summary: '启动时自动检查 · 增量更新 · 测试通道',
      icon: UpdateIcon,
    },
    {
      id: 'diagnostics',
      title: '日志与诊断',
      summary: '记录启动 / 模型 / 对话 / Agent 工具 · 预览与清理',
      icon: LogIcon,
    },
    {
      id: 'about',
      title: '关于与许可',
      summary: '版本、许可与开源边界 · 重播上手指引',
      icon: AboutIcon,
    },
  ]

  const groupBadge = (id: SettingsSection): string => {
    switch (id) {
      case 'appearance': return themeLabel(settings.theme)
      case 'startup': return settings.startupSplash === 'quick' ? '快速启动' : '完整启动页'
      case 'inference': return backendLabel(settings.backend)
      case 'storage': return `${settings.downloadConcurrency} 路下载`
      case 'agent': return settings.agentNetwork ? '联网已开启' : '联网已关闭'
      case 'chat': return settings.chatSendKey === 'ctrl-enter' ? 'Ctrl+Enter 发送' : 'Enter 发送'
      case 'fonts': return fontLabel(settings.chatFont)
      case 'update': return `v${APP_VERSION}`
      case 'diagnostics': return settings.diagnosticLogEnabled
        ? `已开启 · ${settings.diagnosticLogMode === 'size' ? `${settings.diagnosticLogSizeMb} MB` : `${settings.diagnosticLogDays} 天`}`
        : '默认关闭'
      case 'about': return `v${getRuntimeVersion() || APP_VERSION}`
      default: return ''
    }
  }

  const sectionGroups: Array<{ id: string; label: string; hint: string; ids: SettingsSection[] }> = [
    { id: 'everyday', label: '日常', hint: '外观、启动、输入与字体', ids: ['appearance', 'startup', 'chat', 'fonts'] },
    { id: 'model-data', label: '模型与数据', hint: '推理、存储与联网', ids: ['inference', 'storage', 'agent'] },
    { id: 'maintenance', label: '维护', hint: '更新、日志与关于', ids: ['update', 'diagnostics', 'about'] },
  ]

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return searchIndex
      .filter(item => `${item.title} ${item.keywords} ${item.group}`.toLowerCase().includes(q))
      .slice(0, 10)
  }, [query])

  if (section) {
    return (
      <div className="page settings-detail">
        <div className="settings-shell">
          <SectionHeader section={section} onBack={() => setSection(null)} />
          <div className="settings-detail-body">
            {section === 'appearance' && <AppearanceSettings settings={settings} onChange={onChange} />}
            {section === 'startup' && <StartupSettings settings={settings} onChange={onChange} />}
            {section === 'inference' && (
              <InferenceSettings
                hardware={hardware}
                settings={settings}
                onChange={onChange}
                onSourcesChange={setSourceState}
              />
            )}
            {section === 'storage' && <StorageSettings settings={settings} onChange={onChange} onReset={onReset} />}
            {section === 'agent' && <AgentSettings settings={settings} onChange={onChange} />}
            {section === 'chat' && <ChatSettings settings={settings} onChange={onChange} />}
            {section === 'fonts' && <FontLibrary value={settings.chatFont} onChange={onChange} />}
            {section === 'update' && <VersionUpdateSettings settings={settings} onChange={onChange} onOpenReleaseNotes={() => setSection('updates')} />}
            {section === 'diagnostics' && <DiagnosticSettings settings={settings} onChange={onChange} />}
            {section === 'about' && <AboutSettings onReplayTour={onReplayTour} />}
            {section === 'updates' && <UpdateSettings channel={settings.updateChannel} />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page settings-home">
      <div className="settings-shell">
      <div className="page-head settings-home-head">
        <div className="page-head-copy">
          <div className="eyebrow">Preferences</div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">九组设置按日常、模型与数据、维护三块排列；每行右侧只留一个当前状态，字体库只改对话阅读区，不换界面字体。</p>
        </div>
      </div>

      <div className="settings-search-wrap">
        <Search size={16} aria-hidden />
        <input
          ref={searchRef}
          className="settings-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索设置，例如「托盘」「显存」「开机自启」「限速」"
          aria-label="搜索设置"
        />
        {query && (
          <button type="button" className="settings-search-clear" aria-label="清空搜索" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
        <span className="settings-search-shortcut"><Keyboard size={12} />Ctrl+,</span>
      </div>

      {query.trim() ? (
        <div className="settings-search-results" data-tour="settings-index">
          {matches.length > 0 ? matches.map(item => (
            <button
              type="button"
              key={`${item.section}-${item.title}`}
              className="settings-search-hit"
              onClick={() => { setSection(item.section); setQuery('') }}
            >
              <span className="settings-search-hit-group">{item.group}</span>
              <span className="settings-search-hit-title">{item.title}</span>
              <ChevronRight size={15} aria-hidden />
            </button>
          )) : (
            <div className="settings-search-empty">没有匹配的设置项。换个词，或从下面三块入口进入。</div>
          )}
        </div>
      ) : (
        <div className="settings-sections" data-tour="settings-index">
          {sectionGroups.map(group => (
            <section className="settings-section" key={group.id}>
              <div className="settings-section-head">
                <span className="settings-section-label">{group.label}</span>
                <span className="settings-section-hint">{group.hint}</span>
              </div>
              <div className="settings-section-card">
                {group.ids.map(id => {
                  const item = groups.find(entry => entry.id === id)
                  if (!item) return null
                  const Icon = item.icon
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className="settings-row"
                      aria-label={`打开${item.title}`}
                      onClick={() => setSection(item.id)}
                    >
                      <span className="settings-row-icon" aria-hidden><Icon size={18} /></span>
                      <span className="settings-row-copy">
                        <span className="settings-row-title">{item.title}</span>
                        <span className="settings-row-summary">{item.summary}</span>
                      </span>
                      {groupBadge(item.id) && <span className="settings-row-badge">{groupBadge(item.id)}</span>}
                      <ChevronRight className="settings-row-chevron" size={16} aria-hidden />
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {!query.trim() && (
        <p className="settings-index-note">偏好设置保存在 %APPDATA%\ModelDock；设置入口固定在导航底部，按 Ctrl+, 可随时打开。字体文件另存在 fonts 目录，删除后可回到系统字体。</p>
      )}

      <footer className="settings-footer">
        <div className="settings-footer-brand">
          <BrandMark size={20} />
          <span>天枢 v{getRuntimeVersion() || APP_VERSION}</span>
        </div>
        <div className="settings-footer-links">
          <button type="button" onClick={() => setSection('about')}>关于</button>
          <button type="button" onClick={() => setSection('updates')}>更新公告</button>
          <button type="button" onClick={onReplayTour}><Compass size={13} />上手指引</button>
          <button type="button" onClick={() => setSection('about')}>许可</button>
        </div>
      </footer>
      </div>
    </div>
  )
}
