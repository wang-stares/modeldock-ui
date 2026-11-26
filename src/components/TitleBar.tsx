import type { AgentProfileId, PageKey } from '../types'
import { BrandMark } from './BrandMark'
import { WindowControls } from './WindowControls'

const labels: Record<PageKey, string> = {
  library: '模型库',
  models: '我的模型',
  chat: '对话',
  downloads: '下载中心',
  settings: '设置',
}

// 形态 = 哪个 agent 在做事：工具集、预算、工作法都由它决定（内核只有一份，差异全在 AgentProfile）。
const agents: { id: AgentProfileId; label: string; hint: string }[] = [
  { id: 'office', label: '办公', hint: '办公 agent：整理文档、表格与批量文件，只读写工作区，不执行任何命令。' },
  { id: 'code', label: '编程', hint: '编程 agent：读代码、改文件、按白名单执行命令；命令每次都要你点头。' },
]

export function TitleBar({ page, agent, onAgent }: {
  page: PageKey
  agent: AgentProfileId
  onAgent: (next: AgentProfileId) => void
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand-mark" aria-hidden><BrandMark size={28} /></div>
      <div className="brand-name">天枢</div>
      {/* 切形态放在左上角：它换的是「谁来干活」，不是「这一句要不要动手」。 */}
      <div className="seg titlebar-agents" role="tablist" aria-label="切换 agent 形态">
        {agents.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={agent === item.id}
            className={agent === item.id ? 'on' : ''}
            title={item.hint}
            data-tour={`agent-${item.id}`}
            onClick={() => onAgent(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="titlebar-page">{labels[page]}</div>
      <WindowControls />
    </header>
  )
}
