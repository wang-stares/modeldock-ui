import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Boxes,
  DownloadCloud,
  Gauge,
  HardDrive,
  Keyboard,
  MessageSquareText,
  MousePointerClick,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DownloadJob, PageKey } from '../types'
import { BrandMark } from './BrandMark'

interface TourPoint {
  icon: LucideIcon
  title: string
  text: string
}

interface TourStep {
  id: string
  page?: PageKey
  /** 页面内的具体控件；窄窗口下回落到侧栏入口，避免提示卡盖住控件。 */
  target?: string
  fallbackTarget?: string
  navTarget?: string
  minWidthForTarget?: number
  eyebrow: string
  title: string
  copy: string
  icon: LucideIcon
  action?: string
  points?: TourPoint[]
}

interface TourContext {
  downloaded: number
  downloading: number
}

interface NextAction {
  page: PageKey
  label: string
  hint: string
}

function makeNextAction(context: TourContext): NextAction {
  if (context.downloaded > 0) {
    return { page: 'chat', label: '开始第一次对话', hint: `本机已有 ${context.downloaded} 个可用模型` }
  }
  if (context.downloading > 0) {
    return { page: 'downloads', label: '查看下载进度', hint: `${context.downloading} 个下载任务正在进行` }
  }
  return { page: 'library', label: '选择首个模型', hint: '建议从「推荐运行」的模型开始' }
}

function buildSteps(context: TourContext): TourStep[] {
  const { downloaded, downloading } = context

  return [
    {
      id: 'welcome',
      eyebrow: '首次使用',
      title: '欢迎使用天枢',
      copy: '天枢将模型、推理与会话全部保留在本机。接下来用一两分钟完成「选择模型 → 下载 → 对话」，即可开始第一次对话。',
      icon: Sparkles,
      points: [
        { icon: Boxes, title: '模型库', text: '依据本机内存与显存筛选可运行的量化档位，并在卡片中给出评估结论。' },
        { icon: DownloadCloud, title: '下载中心', text: '后台下载、失败自动换源、写入前完整性校验，无需持续等待。' },
        { icon: MessageSquareText, title: '对话', text: '支持 Ollama、Edge0 与内置运行时，仅在本机处理，内容不会离开设备。' },
      ],
    },
    {
      id: 'library',
      page: 'library',
      target: '[data-tour="library-first"]',
      fallbackTarget: '[data-tour="library-recommend-tab"]',
      navTarget: '[data-tour="nav-library"]',
      minWidthForTarget: 1260,
      eyebrow: '第 1 步 · 模型库',
      title: '选择本机可运行的模型',
      copy: '推荐页依据本机内存与显存计算推理预算，仅展示可运行的量化档位。首次使用建议选择「推荐运行」，不优先考虑「受限运行」。',
      icon: Boxes,
      points: [
        { icon: Gauge, title: '理解结论', text: '推荐运行：余量充足；可运行：建议关闭占用较高的其他程序；受限运行：生成速度可能明显下降。' },
        { icon: HardDrive, title: '关注体积', text: '首次建议选择 2–5 GB 的 7B 级 Q4 模型；Q4 为压缩量化档位，体积更小、质量略有下降。' },
        { icon: BadgeCheck, title: '核对授权', text: '「可商用」表示许可证允许商用，仍需遵守署名等条款；「商用需确认」请先核对许可证原文。' },
      ],
      action: '点击推荐卡右下角的「下载」；切换至「全部」可搜索关键词，也可通过「档位」调整量化版本。',
    },
    {
      id: 'downloads',
      page: 'downloads',
      target: '[data-tour="downloads-empty-cta"]',
      fallbackTarget: '[data-tour="downloads-first"]',
      navTarget: '[data-tour="nav-downloads"]',
      minWidthForTarget: 1100,
      eyebrow: '第 2 步 · 下载中心',
      title: '下载与完整性校验',
      copy: '下载在后台运行，切换页面或最小化窗口不会中断；源站失败时自动切换来源，已下载分片保留用于续传。',
      icon: DownloadCloud,
      points: [
        { icon: DownloadCloud, title: '进度与来源', text: '显示模型名、文件名、百分比与当前来源，可随时取消。' },
        { icon: ShieldCheck, title: '完整性校验', text: 'SHA256 为文件哈希；哈希、文件体积与 GGUF 结构均通过后，文件才会写入模型目录。' },
        { icon: HardDrive, title: '保存位置', text: '完成后保存至 %APPDATA%\\ModelDock\\models，右侧「本地模型」会显示，并可在对话页选择。' },
      ],
      action: '无任务时点击「前往模型库」；有任务时等待状态变为「已完成」。',
    },
    {
      id: 'chat',
      page: 'chat',
      target: '[data-tour="chat-composer"]',
      navTarget: '[data-tour="nav-chat"]',
      minWidthForTarget: 1100,
      eyebrow: '第 3 步 · 对话',
      title: '选择模型并开始对话',
      copy: downloaded > 0
        ? `本机已有 ${downloaded} 个可用模型。输入框下方为模型选择器；选择后即可开始对话。`
        : '输入框下方为模型选择器。当前暂无已完成下载；请先前往模型库下载，或启动本机 Ollama，模型会自动出现。',
      icon: MessageSquareText,
      points: [
        { icon: Boxes, title: '选择模型', text: '点击输入框下方的模型下拉框；GGUF、Ollama 与 Edge0 模型会显示在此。' },
        { icon: Keyboard, title: '发送消息', text: '按 Enter 发送，按 Shift+Enter 换行；生成过程中可随时停止。' },
        { icon: MessageSquareText, title: '会话记录', text: '会话自动保存，下次启动时恢复；左侧可新建或删除会话。' },
      ],
      action: downloaded > 0
        ? '输入「你好，请介绍一下你自己」，然后按 Enter。'
        : '先前往模型库选择「推荐运行」的模型，下载完成后再返回此页。',
    },
    {
      id: 'settings',
      page: 'settings',
      target: '[data-tour="settings-index"]',
      navTarget: '[data-tour="nav-settings"]',
      minWidthForTarget: 1500,
      eyebrow: '第 4 步 · 设置',
      title: '按需调整设置',
      copy: '此页不是上手的必经步骤。设置收成八组卡片，入口固定在导航底部，按 Ctrl+, 也能打开；主题、材质与强调色即时生效，启动与输入单独成组，字体库只改阅读区，关于与更新公告在页脚。',
      icon: Settings2,
      points: [
        { icon: Palette, title: '外观与主题', text: '浅色 / 深色 / 跟随系统；亚克力、云母、纯色三档材质；五档强调色即时生效。' },
        { icon: Settings2, title: '启动与输入', text: '启动页完整或快速、启动落点、关闭收进托盘与登录自启；对话发送键、字号、长行换行与默认形态。' },
        { icon: HardDrive, title: '存储与下载', text: '模型、会话与偏好保存在 %APPDATA%\\ModelDock；模型目录、日志清理、下载并发与限速在此调整。' },
      ],
      action: '重看引导：侧栏指南针，或设置页脚「上手指引」。',
    },
    {
      id: 'done',
      eyebrow: '准备就绪',
      title: downloaded > 0 ? '开始第一次对话' : downloading > 0 ? '等待下载完成' : '选择首个模型',
      copy: downloaded > 0
        ? `本机已有 ${downloaded} 个模型。前往对话页选择模型，即可开始第一次对话。`
        : downloading > 0
          ? `当前有 ${downloading} 个下载任务正在进行。前往下载中心查看进度；状态变为「已完成」后，模型将出现在对话页。`
          : '当前暂无已完成模型。请先前往模型库选择「推荐运行」的模型并点击「下载」；完成后返回对话页。',
      icon: downloaded > 0 ? MessageSquareText : downloading > 0 ? DownloadCloud : Boxes,
      action: makeNextAction(context).hint,
      points: [
        { icon: Boxes, title: '选择模型', text: '在推荐页优先选择「推荐运行」的模型，点击卡片右下角「下载」。' },
        { icon: ShieldCheck, title: '等待校验', text: '在下载中心等待状态变为「已完成」后即可使用。' },
        { icon: MessageSquareText, title: '发送消息', text: '在对话页通过输入框下方的模型选择器选择模型，按 Enter 发送。' },
      ],
    },
  ]
}

interface Hole {
  left: number
  top: number
  width: number
  height: number
}

export function Onboarding({ jobs, onNavigate, onClose }: {
  jobs: DownloadJob[]
  onNavigate: (page: PageKey) => void
  onClose: (completed: boolean, next?: PageKey) => void
}) {
  const downloaded = useMemo(() => jobs.filter(job => job.state === 1).length, [jobs])
  const downloading = useMemo(() => jobs.filter(job => job.state === 0 || job.isRunning).length, [jobs])
  const steps = useMemo(() => buildSteps({ downloaded, downloading }), [downloaded, downloading])
  const next = useMemo(() => makeNextAction({ downloaded, downloading }), [downloaded, downloading])

  const [index, setIndex] = useState(0)
  const [hole, setHole] = useState<Hole | null>(null)
  const [cardHeight, setCardHeight] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const Icon = step.icon
  const last = index === steps.length - 1

  const findTarget = useCallback(() => {
    const current = steps[index]
    const useInternal = window.innerWidth >= (current.minWidthForTarget ?? 1100)
    let element: HTMLElement | null = null
    if (useInternal && current.target) {
      element = document.querySelector<HTMLElement>(current.target)
    }
    if (!element && useInternal && current.fallbackTarget) {
      element = document.querySelector<HTMLElement>(current.fallbackTarget)
    }
    if (!element && current.navTarget) {
      element = document.querySelector<HTMLElement>(current.navTarget)
    }
    return element
  }, [index, steps])

  const measure = useCallback(() => {
    const element = findTarget()
    if (!element) {
      setHole(prev => prev === null ? prev : null)
      return
    }
    let rect = element.getBoundingClientRect()
    // 目标在滚动页里被挡住时，先把它带到视口中间；否则聚光灯会落在窗口外。
    if (element.closest('.page-scroll') && (rect.top < 64 || rect.bottom > window.innerHeight - 24)) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
      rect = element.getBoundingClientRect()
    }
    const nextHole = {
      left: rect.left - 9,
      top: rect.top - 7,
      width: rect.width + 18,
      height: rect.height + 14,
    }
    setHole(prev => {
      if (prev && Math.abs(prev.left - nextHole.left) < 0.5 && Math.abs(prev.top - nextHole.top) < 0.5 &&
        Math.abs(prev.width - nextHole.width) < 0.5 && Math.abs(prev.height - nextHole.height) < 0.5) {
        return prev
      }
      return nextHole
    })
    const measured = cardRef.current?.offsetHeight
    if (measured) {
      setCardHeight(prev => Math.abs(prev - measured) > 0.5 ? measured : prev)
    }
  }, [findTarget])

  useLayoutEffect(() => {
    const current = steps[index]
    if (!current.target && !current.fallbackTarget && !current.navTarget) {
      setHole(null)
    }
    let cancelled = false
    let tries = 0
    const tick = () => { if (!cancelled) measure() }
    const frame = requestAnimationFrame(tick)
    const timer = window.setTimeout(tick, 260)
    const poll = window.setInterval(() => {
      if (cancelled) return
      tries += 1
      tick()
      if (tries >= 10) window.clearInterval(poll)
    }, 300)
    window.addEventListener('resize', tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      window.clearInterval(poll)
      window.removeEventListener('resize', tick)
    }
  }, [index, measure, steps])

  useLayoutEffect(() => {
    const update = () => {
      const height = cardRef.current?.offsetHeight ?? 0
      if (height) setCardHeight(prev => Math.abs(prev - height) > 0.5 ? height : prev)
    }
    update()
    const timer = window.setTimeout(update, 120)
    window.addEventListener('resize', update)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', update)
    }
  }, [index, hole])

  useEffect(() => {
    if (step.page) onNavigate(step.page)
  }, [onNavigate, step.page])

  useEffect(() => {
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [index])

  const close = useCallback((completed: boolean, nextPage?: PageKey) => onClose(completed, nextPage), [onClose])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (index === steps.length - 1) close(true, next.page)
        else setIndex(value => Math.min(value + 1, steps.length - 1))
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex(value => Math.max(value - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, index, next.page, steps.length])

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !cardRef.current) return
    const nodes = cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')
    if (nodes.length === 0) return
    const first = nodes[0]
    const final = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      final.focus()
    } else if (!event.shiftKey && document.activeElement === final) {
      event.preventDefault()
      first.focus()
    }
  }

  const cardStyle = useMemo<CSSProperties | undefined>(() => {
    if (!hole) {
      return { maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }
    }
    const width = cardRef.current?.offsetWidth || (window.innerWidth <= 1040 ? 360 : 392)
    const height = cardHeight || 420
    const gap = 18
    const edge = 18
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const holeRight = hole.left + hole.width
    const holeBottom = hole.top + hole.height

    let left: number
    if (viewportW - holeRight - gap - edge >= width) {
      left = holeRight + gap
    } else if (hole.left - gap - edge >= width) {
      left = hole.left - gap - width
    } else {
      left = hole.left + hole.width / 2 - width / 2
    }
    left = Math.min(Math.max(left, edge), Math.max(viewportW - width - edge, edge))

    let top: number
    if (viewportH - holeBottom - gap - edge >= height) {
      top = holeBottom + gap
    } else if (hole.top - gap - edge >= height) {
      top = hole.top - gap - height
    } else {
      top = hole.top + hole.height / 2 - height / 2
    }
    top = Math.min(Math.max(top, edge), Math.max(viewportH - height - edge, edge))

    return { left, top, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }
  }, [hole, cardHeight])

  function advance() {
    if (last) close(true, next.page)
    else setIndex(value => value + 1)
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-copy">
      {hole ? <div className="tour-hole" style={hole} aria-hidden /> : <div className="tour-veil" aria-hidden />}
      <div
        ref={cardRef}
        key={step.id}
        className={`tour-card ${hole ? '' : 'is-center'} ${step.id}`}
        style={cardStyle}
        onKeyDown={trapFocus}
      >
        <span className="tour-count">{index + 1} / {steps.length}</span>

        {hole ? (
          <div className="tour-head">
            <span className="tour-icon" aria-hidden><Icon size={19} /></span>
            <div className="tour-head-copy">
              <span className="tour-eyebrow">{step.eyebrow}</span>
              <h2 className="tour-title" id="tour-title">{step.title}</h2>
            </div>
          </div>
        ) : (
          <div className="tour-hero">
            <div className="tour-hero-mark" aria-hidden><BrandMark size={step.id === 'welcome' ? 64 : 52} /></div>
            <span className="tour-eyebrow">{step.eyebrow}</span>
            <h2 className="tour-title" id="tour-title">{step.title}</h2>
          </div>
        )}

        <p className="tour-copy" id="tour-copy">{step.copy}</p>

        {step.points && (
          <ul className="tour-points">
            {step.points.map(point => {
              const PointIcon = point.icon
              return (
                <li key={point.title}>
                  <span className="tour-point-icon" aria-hidden><PointIcon size={15} /></span>
                  <span className="tour-point-copy">
                    <b>{point.title}</b>
                    <em>{point.text}</em>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {step.action && (
          <div className="tour-action">
            <MousePointerClick size={14} aria-hidden />
            <span>{step.action}</span>
          </div>
        )}

        <div className="tour-foot">
          <div className="tour-dots" role="tablist" aria-label="引导步骤">
            {steps.map((item, dot) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={dot === index}
                aria-label={`第 ${dot + 1} 步：${item.title}`}
                className={dot === index ? 'active' : dot < index ? 'passed' : ''}
                onClick={() => setIndex(dot)}
              />
            ))}
          </div>
          <div className="tour-actions">
            {index === 0 ? (
              <button type="button" className="btn ghost sm" onClick={() => close(false)}>跳过</button>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => setIndex(value => Math.max(value - 1, 0))}>
                <ArrowLeft />上一步
              </button>
            )}
            <button type="button" ref={primaryRef} className="btn primary sm" onClick={advance}>
              {last ? next.label : index === 0 ? '开始上手' : '下一步'}
              <ArrowRight />
            </button>
          </div>
        </div>
        <div className="tour-keys">Esc 退出 · ← → 切换</div>
      </div>
    </div>
  )
}
