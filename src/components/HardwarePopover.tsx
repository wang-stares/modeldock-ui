import { Cpu, HardDrive, MemoryStick, Monitor, X } from 'lucide-react'
import type { HardwareProfile } from '../types'

function gb(bytes: number | null | undefined) {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function HardwarePopover({ hardware, onClose }: { hardware: HardwareProfile | null; onClose: () => void }) {
  return (
    <div className="popover" role="dialog" aria-label="设备信息">
      <div className="popover-head">
        <div className="popover-title">设备信息</div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="关闭"><X /></button>
      </div>
      {!hardware ? <div className="note">正在读取设备信息…</div> : (
        <>
          <div className="note" style={{ color: 'var(--text-2)' }}>{hardware.summary}</div>
          <div className="hw-grid">
            <div className="hw-field"><div className="hw-label"><Cpu size={11} /> 处理器</div><div className="hw-value">{hardware.cpuName || '未识别'}</div></div>
            <div className="hw-field"><div className="hw-label">核心</div><div className="hw-value">{hardware.coreText}</div></div>
            <div className="hw-field"><div className="hw-label"><MemoryStick size={11} /> 内存</div><div className="hw-value">{hardware.ramText || '未识别'}</div></div>
            <div className="hw-field"><div className="hw-label"><Monitor size={11} /> 显卡</div><div className="hw-value">{hardware.hasGpu ? `${hardware.gpuName} · ${hardware.gpuMemoryGb.toFixed(1)} GB` : '未识别独显'}</div></div>
            <div className="hw-field"><div className="hw-label"><HardDrive size={11} /> 磁盘剩余</div><div className="hw-value">{hardware.freeDiskGb.toFixed(1)} GB</div></div>
            <div className="hw-field"><div className="hw-label">推理预算</div><div className="hw-value">{hardware.budgetGb.toFixed(1)} GB</div></div>
          </div>
          <div className="divider" />
          <div className="note">推理预算优先按显存计算；无独立显卡时，按「预留 2 GB 内存后的 85%」计算。所有读数仅在本机使用，不上传。</div>
        </>
      )}
    </div>
  )
}
