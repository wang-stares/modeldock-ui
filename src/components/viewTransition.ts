import { flushSync } from 'react-dom'

/**
 * 页面切换的“一镜到底”入口。
 *
 * 思路：相机不切，只在同一个取景框里做一次连续运镜。实现交给浏览器
 * View Transitions API——它会把切换前后的画面各拍一张快照，由 CSS 决定
 * 旧画面怎么退、新画面怎么进，中间的共享元素（导航高亮、环境光）自动补间。
 * 不支持（老 WebView2 / 关闭动效）时退化成直接更新，页面自己还有 .page-stage 的兜底动画。
 */

type DocumentWithVT = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<unknown> }
}

let running = 0

export function motionReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
