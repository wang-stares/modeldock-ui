import { flushSync } from 'react-dom'

/**
 * 页面切换的“一镜到底”入口。
 *
 * 思路：相机不切，只在同一个取景框里做一次连续运镜。主路径交给浏览器
 * View Transitions API——它把切换前后的画面各拍一张快照，由 CSS 决定旧画面怎么退、
 * 新画面怎么进，中间的高亮滑块与环境光各走各的补间。
 *
 * 不支持 View Transitions（较老的 WebView2）时不硬切：走 `.page` 的兜底入场动画，
 * 带方向、带过冲，见 global.css 的 page-in。
 */

type DocumentWithVT = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<unknown> }
}

export type OneShotDirection = 'down' | 'up'

let running = 0

export function motionReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 换页方向：往下走（导航往后的页）新页从下方进，往上走则从上方进。 */
export function setOneShotDirection(direction: OneShotDirection): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.vtDir = direction
}

/** 有没有可用的快照运镜。有的话 `.page` 的入场动画要让位，避免两层叠着走。 */
export function hasViewTransition(): boolean {
  if (typeof document === 'undefined') return false
  return typeof (document as DocumentWithVT).startViewTransition === 'function' && !motionReduced()
}

export function markMotionMode(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.motion = hasViewTransition() ? 'vt' : 'css'
}

export function commitAsOneShot(update: () => void): void {
  const doc = document as DocumentWithVT
  if (!doc.startViewTransition || motionReduced() || running > 0) {
    update()
    return
  }
  running += 1
  try {
    const transition = doc.startViewTransition(() => {
      // 快照要求 DOM 在同一帧内落定，React 的批处理必须同步刷出去。
      flushSync(update)
    })
    void transition.finished.finally(() => { running -= 1 })
  } catch {
    running -= 1
    update()
  }
}
