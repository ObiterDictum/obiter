import type { IconProps } from '../icon-base'

const STROKE_WIDTH = { regular: 16, bold: 24, fill: 16 } as const

const HEAD =
  'M 58 180 q -14 -14 0 -28 q -14 -14 0 -28 q -14 -14 0 -28 Q 60 40 128 36 Q 196 40 198 96 q 14 14 0 28 q 14 14 0 28 q 14 14 0 28'
const BROW = 'M 76 108 q 13 -16 26 0 q 13 -16 26 0 q 13 -16 26 0 q 13 -16 26 0'
const FACE = 'M 80 114 Q 80 196 128 222 Q 176 196 176 114'
const MARKINGS = 'M 108 122 L 115 162 M 148 122 L 141 162'

export function Ratio({
  size,
  weight = 'regular',
  color = 'currentColor',
  mirrored,
  alt,
  ...rest
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill={color}
      viewBox="0 0 256 256"
      transform={mirrored ? 'scale(-1, 1)' : undefined}
      {...rest}
    >
      {alt ? <title>{alt}</title> : null}
      <g
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH[weight]}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={HEAD} />
        <path d={BROW} />
        <path d={FACE} fill={weight === 'fill' ? color : 'none'} />
        <path d={MARKINGS} />
      </g>
      <ellipse cx="128" cy="190" rx="14" ry="10" fill={color} />
    </svg>
  )
}
