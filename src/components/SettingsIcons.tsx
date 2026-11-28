/**
 * 设置首页行图标：自绘的一套 24 栅格线性图标。
 *
 * 统一口径：24×24 画布、1.6 描边、圆头端点、只用直线与圆弧，不描细节阴影，
 * 保证 16px 下仍能认出来；每枚图标讲一件事，不堆叠元素。
 * 分组顺序与 `SettingsPage` 的 sectionGroups 对应。
 */
import type { ReactNode } from 'react'

type IconProps = { size?: number; className?: string }

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** 外观与主题：日轮八芒，代表浅色 / 深色与材质明暗。 */
export function ThemeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.9v2.2M12 18.9v2.2M2.9 12h2.2M18.9 12h2.2" />
      <path d="M5.55 5.55l1.55 1.55M16.9 16.9l1.55 1.55M18.45 5.55l-1.55 1.55M7.1 16.9l-1.55 1.55" />
    </Svg>
  )
}

/** 启动与窗口：窗口框架 + 播放三角，兼顾「启动页」与「窗口行为」。 */
export function StartupIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.7c2.9 2.4 4.4 5.4 4.4 8.7l-2.2 3.6h-4.4l-2.2-3.6c0-3.3 1.5-6.3 4.4-8.7z" />
      <circle cx="12" cy="9.3" r="1.5" />
      <path d="M9.8 16l-3.1 3.9 3.5-1.1M14.2 16l3.1 3.9-3.5-1.1" />
      <path d="M10.6 18.5l1.4 2.2 1.4-2.2" />
    </Svg>
  )
}

/** 对话与输入：气泡 + 输入光标，前窄后宽表示「发送键」的落点。 */
export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.2 6.5v7.3a2.5 2.5 0 0 1-2.5 2.5H9.9L5.4 19.9v-3.6a2.5 2.5 0 0 1-1.6-2.5V6.5A2.5 2.5 0 0 1 6.3 4h11.4A2.5 2.5 0 0 1 20.2 6.5z" />
      <path d="M7.6 9.3l2.2 1.8-2.2 1.8" />
      <path d="M12.4 12.9h4.2" />
    </Svg>
  )
}

/** 字体库：A 字骨架 + 基线与字重横，代表阅读区字体而不是界面字体。 */
export function FontIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.4 18.1l5.6-13.2 5.6 13.2" />
      <path d="M8.65 14.2h6.7" />
      <path d="M4.4 20.6h15.2" />
    </Svg>
  )
}

/** 模型与推理：芯片本体 + 八引线 + 内核，代表推理后端与显存预算。 */
export function ModelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7.1" y="7.1" width="9.8" height="9.8" rx="2" />
      <rect x="10.3" y="10.3" width="3.4" height="3.4" rx="0.8" />
      <path d="M9.9 3.4v3.7M14.1 3.4v3.7M9.9 16.9v3.7M14.1 16.9v3.7M3.4 9.9h3.7M3.4 14.1h3.7M16.9 9.9h3.7M16.9 14.1h3.7" />
    </Svg>
  )
}

/** 存储与数据：三层数据柱，代表模型目录、缓存与占用。 */
export function StorageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6.2" rx="7.1" ry="2.9" />
      <path d="M4.9 6.2v11.6c0 1.6 3.2 2.9 7.1 2.9s7.1-1.3 7.1-2.9V6.2" />
      <path d="M4.9 12c0 1.6 3.2 2.9 7.1 2.9s7.1-1.3 7.1-2.9" />
    </Svg>
  )
}

/** Agent 与联网：经纬球，代表联网读取网页与本机记忆的边界。 */
export function AgentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.1" />
      <path d="M3.9 12h16.2" />
      <path d="M12 3.9c2.6 2.2 4 5.1 4 8.1s-1.4 5.9-4 8.1c-2.6-2.2-4-5.1-4-8.1s1.4-5.9 4-8.1z" />
    </Svg>
  )
}

/** 更新与公告：双向循环箭头，代表检查、增量下载与退出安装。 */
export function UpdateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.1 10.3A7 7 0 0 1 17.9 7.4" />
      <path d="M18.6 3.6l.3 4.2-4.2.2" />
      <path d="M18.9 13.7A7 7 0 0 1 6.1 16.6" />
      <path d="M5.4 20.4l-.3-4.2 4.2-.2" />
    </Svg>
  )
}

/** 日志与诊断：折页 + 波形，代表按时间线记录的落盘日志。 */
export function LogIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.1 3.6H7.7A2.5 2.5 0 0 0 5.2 6.1v11.8A2.5 2.5 0 0 0 7.7 20.4h8.6A2.5 2.5 0 0 0 18.8 17.9V8.3z" />
      <path d="M14.1 3.6v4.7h4.7" />
      <path d="M8.2 13h1.9l1-2.1 1.7 4.5 1-2.4h1.9" />
    </Svg>
  )
}

/** 关于与许可：天枢四芒星标，与标题栏品牌标同源。 */
export function AboutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.4l2.1 6.5 6.5 2.1-6.5 2.1L12 20.6l-2.1-6.5-6.5-2.1 6.5-2.1z" />
    </Svg>
  )
}
