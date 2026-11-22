import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { WindowControls } from './WindowControls'
import { APP_VERSION } from '../version'

export type LaunchPhase = 'connect' | 'probe' | 'ready' | 'error'

const STAGES: Record<LaunchPhase, { percent: number; label: string; note: string }> = {
  connect: {
    percent: 22,
    label: '正在连接本机内核',
    note: '启动本机 sidecar，确认接口与一次性令牌可用。',
  },
  probe: {
    percent: 64,
    label: '正在读取硬件与偏好',
    note: '识别处理器、内存与显卡，读回上次的主题与材质。',
  },  ready: {
    percent: 100,
    label: '准备完成',
    note: '工作台已就绪，正在进入。',
  },
  error: {
    percent: 100,
    label: '本机内核没有响应',
    note: '可以先检查安装目录与日志，再重新连接。',
  },
}

export function SplashScreen({ phase, error, onRetry, onDone }: {
  phase: LaunchPhase
  error: string
  onRetry: () => void
  onDone: () => void
}) {
  const reduced = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    [],
  )
  const [introDone, setIntroDone] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [closing, setClosing] = useState(false)
  const finished = useRef(false)
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroDone(true), reduced ? 320 : 1180)
    return () => window.clearTimeout(timer)
  }, [reduced])

  useEffect(() => {
    if (!introDone || phase !== 'ready') return
    const timer = window.setTimeout(() => setClosing(true), reduced ? 40 : 200)
    return () => window.clearTimeout(timer)
  }, [introDone, phase, reduced])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => {
      if (finished.current) return
      finished.current = true
      onDone()
    }, reduced ? 90 : 520)
    return () => window.clearTimeout(timer)
  }, [closing, onDone, reduced])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || phase === 'error') return
      event.preventDefault()
      if (!introDone) {
        setSkipped(true)
        setIntroDone(true)
      } else if (phase === 'ready') {
        setClosing(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [introDone, phase])

  useEffect(() => {
    if (phase !== 'error') return
    const timer = window.setTimeout(() => retryRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [phase])

  const stage = STAGES[phase]
  const isError = phase === 'error'
  const percent = stage.percent
  const detail = isError
    ? (/failed to fetch|load failed|network ?error/i.test(error) || !error.trim()
        ? '本机 sidecar 没有在预期时间内就绪。请检查端口占用、安装目录与日志，然后重新连接。'
        : error)
    : ''

  return (
    <section
      className={`launch ${skipped ? 'is-settled' : ''} ${closing ? 'is-leaving' : ''}`}
      data-phase={phase}
      aria-label={isError ? '本机内核没有响应' : '天枢正在启动'}
      aria-busy={phase !== 'ready' && !isError}
    >
      <div className="launch-stars" aria-hidden />
      <div className="launch-vignette" aria-hidden />

      <header className="launch-chrome" data-tauri-drag-region>
        <div className="launch-brand" data-tauri-drag-region>
          <BrandMark size={22} />
          <span>天枢</span>
        </div>
        <div className="launch-chrome-spacer" data-tauri-drag-region />
        <WindowControls />
      </header>

      <main className="launch-stage">
        <div className={`launch-orbit ${isError ? 'is-error' : ''}`} aria-hidden>
          <i className="launch-ring outer" />
          <i className="launch-ring main" />
          <i className="launch-ring inner" />
          <div className="launch-satellite"><i /></div>
          <div className="launch-mark"><BrandMark size={112} /></div>
        </div>

        <div className="launch-word" aria-label="天枢">
          <span>天</span><span>枢</span>
        </div>
        <div className="launch-kicker">TIANSHU · LOCAL MODEL WORKBENCH</div>
        <p className="launch-copy">把模型收拢到这台机器。找模型、下载、校验、推理与对话，都在本地完成。</p>

        <div className="launch-meter">
          <div className="launch-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="启动进度">
            <i style={{ width: `${percent}%` }} />
            <b style={{ left: `calc(${percent}% - 8px)` }} />
          </div>
          <div className="launch-status" role="status" aria-live="polite">
            <span className={`launch-dot ${isError ? 'error' : phase === 'ready' ? 'ready' : ''}`} />
            <span>{stage.label}</span>
          </div>
          <div className="launch-note">{stage.note}</div>
        </div>

        {isError && (
          <div className="launch-error" role="alert">
            <p title={error}>{detail}</p>
            <button ref={retryRef} className="btn primary" onClick={onRetry}>
              <RefreshCw />
              重新连接
            </button>
          </div>
        )}

        {!isError && !introDone && (
          <button className="launch-skip" onClick={() => { setSkipped(true); setIntroDone(true) }}>
            跳过动画 <kbd>Esc</kbd>
          </button>
        )}
      </main>

      <footer className="launch-foot">
        <span>v{APP_VERSION}</span>
        <span className="launch-foot-mid">本地推理 · 数据不出设备</span>
        <span>Windows 10 / 11 x64</span>
      </footer>
    </section>
  )
}
