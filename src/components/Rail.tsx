import { useLayoutEffect, useRef, useState } from 'react'
import { Boxes, Compass, Cpu, DownloadCloud, MessageSquareText, PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react'
import type { PageKey } from '../types'
import { APP_VERSION } from '../version'
import { getRuntimeVersion } from '../api'

const items: { key: PageKey; label: string; icon: typeof Boxes }[] = [
  { key: 'library', label: '模型库', icon: Boxes },
  { key: 'models', label: '我的模型', icon: Cpu },
  { key: 'chat', label: '对话', icon: MessageSquareText },
  { key: 'downloads', label: '下载中心', icon: DownloadCloud },
]

const settingsItem = { key: 'settings' as const, label: '设置', icon: Settings2 }

export function Rail({ page, onNavigate, runningDownloads, backend, onTour, collapsed, onToggle }: {
  page: PageKey
  onNavigate: (page: PageKey) => void
  runningDownloads: number
  backend: string
  onTour: () => void
  /** 折叠成图标条。**没有拖拽调宽的边框**：宽度只有展开/折叠两档，不做连续调节。 */
  collapsed: boolean
  onToggle: () => void
}) {
  const railRef = useRef<HTMLElement | null>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  const shownVersion = getRuntimeVersion() || APP_VERSION
  const versionMismatch = !!getRuntimeVersion() && getRuntimeVersion() !== APP_VERSION
  const SettingsIcon = settingsItem.icon

  // 高亮块跟着当前页在侧栏里滑动，换页时不做淡出淡入——这是“一镜到底”的锚点。
  useLayoutEffect(() => {
    const host = railRef.current
    if (!host) return
    const measure = () => {
      const active = host.querySelector<HTMLElement>('.nav-item.active')
      if (!active) { setPill(null); return }
      const hostRect = host.getBoundingClientRect()
      const itemRect = active.getBoundingClientRect()
      setPill({ top: itemRect.top - hostRect.top, height: itemRect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [page, collapsed])

  return (
    <aside className={`rail ${collapsed ? 'collapsed' : ''}`} ref={railRef}>
      {pill && <span className="rail-pill" aria-hidden style={{ top: pill.top, height: pill.height }} />}
      <div className="rail-head">
        {!collapsed && <div className="rail-label">工作台</div>}
        <button
          type="button"
          className="btn ghost icon sm rail-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开工作台' : '收起工作台'}
          title={collapsed ? '展开工作台' : '收起工作台'}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>
      <nav className="nav" aria-label="主导航">
        {items.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={page === item.key ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              data-tour={`nav-${item.key}`}
            >
              <Icon className="nav-icon" />
              {!collapsed && <span>{item.label}</span>}
              {item.key === 'downloads' && runningDownloads > 0 && <b className="nav-badge">{runningDownloads}</b>}
            </button>
          )
        })}
      </nav>
      <div className="rail-spacer" />
      <nav className="nav nav-settings" aria-label="固定入口">
        <button
          className={`nav-item ${page === settingsItem.key ? 'active' : ''}`}
          onClick={() => onNavigate(settingsItem.key)}
          aria-current={page === settingsItem.key ? 'page' : undefined}
          title={collapsed ? settingsItem.label : undefined}
          aria-label={collapsed ? settingsItem.label : undefined}
          data-tour="nav-settings"
        >
          <SettingsIcon className="nav-icon" />
          {!collapsed && <span>{settingsItem.label}</span>}
        </button>
      </nav>
      {!collapsed && (
        <div className="rail-card">
          <div className="rail-card-head"><i className="status-dot" />{backend === 'ollama' ? 'Ollama 在线' : '本地推理'}</div>
          <div className="rail-card-sub">模型与推理仅在本机运行</div>
        </div>
      )}
      <div className="rail-foot">
        {!collapsed && (
          <span title={versionMismatch ? `界面组件 v${APP_VERSION} 与后台内核 v${getRuntimeVersion()} 不一致` : undefined}>
            v{shownVersion}{versionMismatch ? ' !' : ''}
          </span>
        )}
        <button type="button" className="rail-tour" onClick={onTour} title="上手指引" aria-label="打开上手指引">
          <Compass />
          {!collapsed && <span>指引</span>}
        </button>
        {!collapsed && <span>本地</span>}
      </div>
    </aside>
  )
}
