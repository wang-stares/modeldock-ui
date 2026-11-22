import { Minus, Square, X } from 'lucide-react'

async function call(command: string) {
  try {
    const core = await import('@tauri-apps/api/core')
    await core.invoke(command)
  } catch {
    // browser preview
  }
}

/** 无边框窗口的最小化 / 最大化 / 关闭；标题栏与启动页共用。 */
export function WindowControls() {
  return (
    <div className="window-controls">
      <button className="window-btn" aria-label="最小化" onClick={() => call('window_minimize')}><Minus /></button>
      <button className="window-btn" aria-label="最大化" onClick={() => call('window_toggle_maximize')}><Square /></button>
      <button className="window-btn close" aria-label="关闭" onClick={() => call('window_close')}><X /></button>
    </div>
  )
}
