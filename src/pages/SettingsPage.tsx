import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Compass, Cpu, ExternalLink, Globe2, HardDrive, Info, Layers, Megaphone, Monitor, Moon, Palette, RefreshCw, Sun, Waves } from 'lucide-react'
import { api } from '../api'
import { releaseHistory } from '../data/releaseHistory'
import { APP_VERSION } from '../version'
import type { AppSettings, Edge0State, HardwareProfile, ModelSourcesState } from '../types'
import { BrandMark } from '../components/BrandMark'

const accents = [
  { name: 'Miuix 蓝', value: '#3482ff' },
  { name: '深蓝', value: '#277af7' },
  { name: '湖青', value: '#0a9e8c' },
  { name: '莓红', value: '#d64570' },
  { name: '石墨', value: '#5b6472' },
]

type SettingsSection = 'appearance' | 'inference' | 'sources' | 'storage' | 'about' | 'updates'

const sectionMeta: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
  appearance: {
    eyebrow: 'Appearance',
    title: '外观与材质',
    description: '主题、窗口材质与强调色。切换后立即生效，不重启窗口。',
  },
  inference: {
    eyebrow: 'Local inference',
    title: '本地推理',
    description: '当前设备的处理器、内存、显卡与推理预算；此页只读，不会修改系统设置。',
  },
  sources: {
    eyebrow: 'Model sources',
    title: '模型来源',
    description: '选择参与模型库与下载的模型来源。四个来源可分别开关；关闭的来源不会发出请求，需要额外凭据的来源在开启后展开配置。',
  },
  storage: {
    eyebrow: 'Storage',
    title: '存储与数据',
    description: '模型、会话与界面偏好均保存在本机数据目录，不写入系统目录。',
  },
  about: {
    eyebrow: 'About',
    title: '关于天枢',
    description: '版本信息、应用框架与设计规范。',
  },
  updates: {
    eyebrow: 'Release notes',
    title: '更新公告',
    description: '收录 v1.0.0 起的全部版本；当前版本汇总现有功能；只读，随安装包发布。',
  },
}

function themeLabel(value: AppSettings['theme']) {
  return value === 'light' ? '浅色' : value === 'dark' ? '深色' : '跟随系统'
}

function materialLabel(value: AppSettings['material']) {
  return value === 'acrylic' ? '亚克力' : value === 'mica' ? '云母' : '纯色'
}

function cleanCpuName(name?: string) {
  return name?.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim() || '正在读取硬件'
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

function AppearanceSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  return (
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
  )
}

function InferenceSettings({ hardware, settings, onChange }: {
  hardware: HardwareProfile | null
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
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
    </>
  )
}

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

function StorageSettings({ hardware }: { hardware: HardwareProfile | null }) {
  return (
    <>
      <section className="settings-card settings-detail-card">
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">数据目录</div>
            <div className="setting-desc">GGUF 模型、会话记录与界面偏好均保存在此目录。</div>
          </div>
          <code className="settings-path">%APPDATA%\ModelDock</code>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-name">目录结构</div>
            <div className="setting-desc">模型文件、sessions.json、日志与界面偏好文件（ui-theme / ui-backdrop / ui-accent）。</div>
          </div>
          <span className="chip">本地</span>
        </div>
        {hardware && (
          <div className="setting-row">
            <div className="setting-copy">
              <div className="setting-name">当前可用空间</div>
              <div className="setting-desc">依据磁盘探测结果展示</div>
            </div>
            <span className="chip">{hardware.freeDiskGb.toFixed(1)} GB</span>
          </div>
        )}
      </section>
      <p className="settings-note">这里只读，不提供移动或清理入口；删除数据目录会同时带走模型、会话与偏好。</p>
    </>
  )
}

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

function UpdateSettings() {
  const historyCount = releaseHistory.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <>
      <section className="settings-card settings-detail-card release-card">
        <div className="release-head">
          <div className="release-head-top">
            <span className="release-latest"><Megaphone size={12} /> 当前版本</span>
            <span className="release-date">2026-11-22 · 全功能版</span>
          </div>
          <div className="release-version">v{APP_VERSION}</div>
          <h2 className="release-title">模型来源独立开关</h2>
          <p className="release-summary">本次将模型来源改为四个独立开关：魔搭、魔搭国际、Hugging Face 与 OpenCSG 均可单独启用，关闭后立即退出搜索、推荐与下载。OpenCSG 开启后才展开 Access Token 配置；未配置时保留开关状态并标记为待配置。模型库来源数量改为读取实际可用来源。</p>
        </div>

        <div className="release-grid">
          <div className="release-block">
            <div className="release-block-title">模型与下载</div>
            <ul className="release-list">
              <li>四个模型来源独立开关，关闭来源不参与搜索与下载</li>
              <li>推荐 / 全部目录，多源结果实时去重</li>
              <li>断点续传、源站 SHA256 / 文件体积 / GGUF 结构校验</li>
              <li>依据内存与显存评估本机运行条件</li>
            </ul>
          </div>
          <div className="release-block">
            <div className="release-block-title">推理与对话</div>
            <ul className="release-list">
              <li>优先复用 Ollama，内置 llama.cpp 作为回退</li>
              <li>GGUF 模型加载、CPU 推理与模型切换</li>
              <li>流式输出、会话持久化与启动握手</li>
            </ul>
          </div>
          <div className="release-block">
            <div className="release-block-title">外观与数据</div>
            <ul className="release-list">
              <li>启动页、六步上手指引与侧栏重播入口</li>
              <li>Miuix 设计规范、浅色 / 深色 / 跟随系统</li>
              <li>亚克力 / 云母 / 纯色材质与强调色</li>
              <li>二级设置页、来源开关与 Token 存储边界</li>
            </ul>
          </div>
        </div>

        <div className="release-history">
          <div className="release-history-head">
            <span>历史版本</span>
            <span className="release-history-count">v1.0.0 起 · {historyCount + 1} 个版本</span>
          </div>
          {releaseHistory.map(group => (
            <details className="release-group" key={group.major}>
              <summary className="release-group-summary">
                <span className="release-group-label">{group.label}</span>
                <span className="release-group-range">{group.range}</span>
                <span className="release-group-count">{group.items.length} 个版本</span>
                <ChevronDown className="release-group-chevron" size={16} aria-hidden />
              </summary>
              <div className="release-group-list">
                {group.items.map(item => (
                  <div className="release-history-item" key={item.version}>
                    <span className="release-history-version">v{item.version}</span>
                    <span className="release-history-date">{item.date}</span>
                    <span className="release-history-copy">{item.title}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>
      <p className="settings-note">此页只展示随安装包发布的更新公告，不联网检查更新；历史条目来自 CHANGELOG.md，后续每个版本都会补一行。</p>
    </>
  )
}

export function SettingsPage({ settings, onChange, hardware, onReplayTour }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  hardware: HardwareProfile | null
  onReplayTour: () => void
}) {
  const [section, setSection] = useState<SettingsSection | null>(null)
  const [sourceState, setSourceState] = useState<ModelSourcesState | null>(null)
  const accentLabel = accents.find(accent => accent.value === settings.accent)?.name ?? '自定义强调色'
  const cpuLabel = cleanCpuName(hardware?.cpuName)
  const inferenceSummary = hardware
    ? `${cpuLabel} · ${hardware.ramGb.toFixed(0)} GB · ${hardware.hasGpu ? hardware.gpuName : 'CPU 推理'}`
    : '正在读取设备信息'

  useEffect(() => {
    let alive = true
    void api.sources().then(state => {
      if (alive) setSourceState(state)
    }).catch(() => { /* 读不到就按来源页自己的提示处理，不影响其他设置 */ })
    return () => { alive = false }
  }, [])

  const categories: Array<{
    id: SettingsSection
    title: string
    summary: string
    icon: typeof Palette
  }> = [
    {
      id: 'appearance',
      title: '外观与材质',
      summary: `${themeLabel(settings.theme)} · ${materialLabel(settings.material)} · ${accentLabel}`,
      icon: Palette,
    },
    {
      id: 'inference',
      title: '本地推理',
      summary: inferenceSummary,
      icon: Cpu,
    },
    {
      id: 'sources',
      title: '模型来源',
      summary: sourceState === null ? '正在读取模型来源' : sourceState.enabledCount === 0 ? '未启用任何来源' : sourceState.sources.some(source => source.enabled && !source.ready) ? `${sourceState.enabledCount} 个已启用 · 有来源待配置` : `${sourceState.enabledCount} 个来源已启用`,
      icon: Globe2,
    },
    {
      id: 'storage',
      title: '存储与数据',
      summary: '%APPDATA%\\ModelDock',
      icon: HardDrive,
    },
    {
      id: 'about',
      title: '关于天枢',
      summary: `v${APP_VERSION} · Tauri 2 + React`,
      icon: Info,
    },
    {
      id: 'updates',
      title: '更新公告',
      summary: `v${APP_VERSION} · 全部历史`,
      icon: Megaphone,
    },
  ]

  if (section) {
    return (
      <div className="page settings-detail">
        <SectionHeader section={section} onBack={() => setSection(null)} />
        <div className="settings-detail-body">
          {section === 'appearance' && <AppearanceSettings settings={settings} onChange={onChange} />}
          {section === 'inference' && <InferenceSettings hardware={hardware} settings={settings} onChange={onChange} />}
          {section === 'sources' && <SourcesSettings onStateChange={setSourceState} />}
          {section === 'storage' && <StorageSettings hardware={hardware} />}
          {section === 'about' && <AboutSettings onReplayTour={onReplayTour} />}
          {section === 'updates' && <UpdateSettings />}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">Preferences</div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">按功能分为六个分组，进入后仅处理对应设置；所有偏好仅保存在本机，不上传。</p>
        </div>
      </div>

      <div className="settings-index" data-tour="settings-index">
        {categories.map(item => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className="settings-menu-item"
              aria-label={`打开${item.title}`}
              onClick={() => setSection(item.id)}
            >
              <span className="settings-menu-icon" aria-hidden><Icon size={19} /></span>
              <span className="settings-menu-copy">
                <span className="settings-menu-title">{item.title}</span>
                <span className="settings-menu-summary">{item.summary}</span>
              </span>
              <ChevronRight className="settings-menu-chevron" size={18} aria-hidden />
            </button>
          )
        })}
      </div>
      <p className="settings-index-note">偏好设置保存在 %APPDATA%\ModelDock；此页仅展示入口，不在单页堆叠全部选项。</p>
    </div>
  )
}
