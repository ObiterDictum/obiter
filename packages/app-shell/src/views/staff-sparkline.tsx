import { CHART_SURFACE, sparklinePoints } from './staff-chart-data'

export function Sparkline({
  values,
  colour,
  label,
}: {
  values: number[]
  colour: string
  label: string
}) {
  const geometry = sparklinePoints(values, 120, 36)
  if (!geometry) return null
  return (
    <svg
      viewBox="0 0 120 36"
      role="img"
      aria-label={label}
      className="block h-9 w-full"
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
        fill={CHART_SURFACE}
      />
      <circle cx={geometry.end.x} cy={geometry.end.y} r="2" fill={colour} />
    </svg>
  )
}
