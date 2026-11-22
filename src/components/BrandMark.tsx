import brandMark from '../assets/brand-mark.png'

/** The Tianshu mark used in the title bar and about card. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={brandMark}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      style={{ flex: `0 0 ${size}px`, display: 'block' }}
    />
  )
}
