import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { RefreshCw } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { WindowControls } from './WindowControls'
import { APP_VERSION } from '../version'

export type LaunchPhase = 'connect' | 'probe' | 'ready' | 'error'

/**
 * 启动页时间线（毫秒，从挂载算起），与 launch.css 里的动画延迟一一对应：
 * 0.00s 星野与星云浮现 → 0.20s 流星划过 → 0.12s 星芒点亮 → 0.24s 强光炸开
 * 0.30s 三条轨道展开并开始缓慢旋转，0.35s 起八道流光向中心汇聚
 * 0.70s 字标逐字浮起 → 1.20s 副标与说明 → 1.50s 进度条
 *
 * 入场走完（2.1s）之前不允许收场，满 3.0s 且内核就绪后再停 0.6s 展示「准备完成」，
 * 最后 0.64s 收场。冷启动 sidecar 慢时继续按真实进度等待，不提前收场。
 *
 * 启动页不跟随系统的「减少动态效果」压成 0.6 秒：很多 Windows（尤其云桌面）
 * 为了性能关掉了客户端动画，WebView 会报 prefers-reduced-motion，启动页就会
 * 一闪而过。这里固定播完整入场，同时保留「跳过启动动画」和 Esc 给不想看的人。
 */
const INTRO_MS = 2100
const MIN_VISIBLE_MS = 3000
const READY_HOLD_MS = 600
const EXIT_MS = 640

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

/** 汇聚的流光：起点相对舞台中心的偏移，延迟错开，最后在星芒处收束。 */
const SPARKS: Array<{ x: string; y: string; delay: number }> = [
  { x: '-46vw', y: '-30vh', delay: 300 },
  { x: '48vw', y: '-26vh', delay: 420 },
  { x: '-54vw', y: '6vh', delay: 480 },
  { x: '44vw', y: '28vh', delay: 360 },
  { x: '-28vw', y: '40vh', delay: 560 },
  { x: '58vw', y: '-4vh', delay: 620 },
  { x: '-16vw', y: '-46vh', delay: 700 },
  { x: '20vw', y: '44vh', delay: 780 },
]

export function SplashScreen({ phase, error, onRetry, onDone }: {
  phase: LaunchPhase
  error: string
  onRetry: () => void
  onDone: () => void
}) {
  const [introDone, setIntroDone] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [closing, setClosing] = useState(false)
  const finished = useRef(false)
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const intro = window.setTimeout(() => setIntroDone(true), INTRO_MS)
    const gate = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS)
    return () => {
      window.clearTimeout(intro)
      window.clearTimeout(gate)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    if (!skipped && (!introDone || !minElapsed)) return
    const delay = skipped ? 120 : READY_HOLD_MS
    const timer = window.setTimeout(() => setClosing(true), delay)
    return () => window.clearTimeout(timer)
  }, [phase, introDone, minElapsed, skipped])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => {
      if (finished.current) return
      finished.current = true
      onDone()
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [closing, onDone])

  const skip = useCallback(() => {
    setSkipped(true)
    setIntroDone(true)
    setMinElapsed(true)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || phase === 'error') return
      event.preventDefault()
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, skip])

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
      <div className="launch-sky" aria-hidden>
        <div className="launch-nebula" />
        <div className="launch-stars far" />
        <div className="launch-stars near" />
        <div className="launch-comet" />
      </div>
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
        <div className="launch-inflow" aria-hidden>
          {SPARKS.map((spark, index) => (
            <i
              key={index}
              style={{ '--dx': spark.x, '--dy': spark.y, '--d': `${spark.delay}ms` } as CSSProperties}
            />
          ))}
        </div>

        <div className={`launch-orbit ${isError ? 'is-error' : ''}`} aria-hidden>
          <span className="launch-rays" />
          <i className="launch-ring outer" />
          <i className="launch-ring main" />
          <i className="launch-ring inner" />
          <span className="launch-flash" />
          <i className="launch-beacon" />
          <div className="launch-satellite"><i /></div>
          <div className="launch-mark">
            <BrandMark size={112} />
            <i className="launch-mark-shine" />
          </div>
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

        {!isError && !closing && (
          <button className="launch-skip" onClick={skip}>
            跳过启动动画 <kbd>Esc</kbd>
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
