import { useElementWidth } from '../use-element-width'
import { sparklinePoints } from './staff-chart-data'

const TILE_SURFACE = 'var(--obiter-surface)'

export function Sparkline({
  values,
  colour,
  label,
}: {
  values: number[]
  colour: string
  label: string
}) {
  const { ref, width } = useElementWidth(340)
  const geometry = sparklinePoints(values, width, 48)
  if (!geometry) return <div ref={ref} className="h-12 w-full" />
  return (
    <div ref={ref} className="h-12 w-full">
      <svg
        viewBox={`0 0 ${width} 48`}
        width={width}
        height={48}
        role="img"
        aria-label={label}
        className="block"
      >
        <polyline
          points={geometry.points}
          fill="none"
          stroke={colour}
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={geometry.end.x}
          cy={geometry.end.y}
          r="4"
          fill={TILE_SURFACE}
        />
        <circle cx={geometry.end.x} cy={geometry.end.y} r="2" fill={colour} />
      </svg>
    </div>
  )
}
