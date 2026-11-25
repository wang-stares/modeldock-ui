import { Boxes, Compass, DownloadCloud, MessageSquareText, Settings2 } from 'lucide-react'
import type { PageKey } from '../types'
import { APP_VERSION } from '../version'
import { getRuntimeVersion } from '../api'

const items: { key: PageKey; label: string; icon: typeof Boxes }[] = [
  { key: 'library', label: '模型库', icon: Boxes },
  { key: 'chat', label: '对话', icon: MessageSquareText },
  { key: 'downloads', label: '下载中心', icon: DownloadCloud },
  { key: 'settings', label: '设置', icon: Settings2 },
]

export function Rail({ page, onNavigate, runningDownloads, backend, onTour }: {
  page: PageKey
  onNavigate: (page: PageKey) => void
  runningDownloads: number
  backend: string
  onTour: () => void
}) {
  const shownVersion = getRuntimeVersion() || APP_VERSION
  const versionMismatch = !!getRuntimeVersion() && getRuntimeVersion() !== APP_VERSION

  return (
    <aside className="rail">
      <div className="rail-label">工作台</div>
      <nav className="nav" aria-label="主导航">
        {items.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={page === item.key ? 'page' : undefined}
              title={item.label}
              data-tour={`nav-${item.key}`}
            >
              <Icon className="nav-icon" />
              <span>{item.label}</span>
              {item.key === 'downloads' && runningDownloads > 0 && <b className="nav-badge">{runningDownloads}</b>}
            </button>
          )
        })}
      </nav>
      <div className="rail-spacer" />
      <div className="rail-card">
        <div className="rail-card-head"><i className="status-dot" />{backend === 'ollama' ? 'Ollama 在线' : '本地推理'}</div>
        <div className="rail-card-sub">模型与推理仅在本机运行</div>
      </div>
      <div className="rail-foot">
        <span title={versionMismatch ? `界面组件 v${APP_VERSION} 与后台内核 v${getRuntimeVersion()} 不一致` : undefined}>
          v{shownVersion}{versionMismatch ? ' !' : ''}
        </span>
        <button type="button" className="rail-tour" onClick={onTour} title="上手指引" aria-label="打开上手指引">
          <Compass />
          <span>指引</span>
        </button>
        <span>本地</span>
      </div>
    </aside>
  )
}
