import type { PageKey } from '../types'
import { BrandMark } from './BrandMark'
import { WindowControls } from './WindowControls'

const labels: Record<PageKey, string> = {
  library: '模型库',
  chat: '对话',
  downloads: '下载中心',
  settings: '设置',
}

export function TitleBar({ page }: { page: PageKey }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand-mark" aria-hidden><BrandMark size={28} /></div>
      <div className="brand-name">天枢</div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="titlebar-page">{labels[page]}</div>
      <WindowControls />
    </header>
  )
}
