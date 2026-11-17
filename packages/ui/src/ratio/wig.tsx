const PAPER = '#fbf8f0'
const LINE = '#9c917b'

export function Roll({
  x,
  y,
  width,
  height,
  direction,
}: {
  x: number
  y: number
  width: number
  height: number
  direction: 1 | -1
}) {
  const radius = height / 2
  const end = direction < 0 ? x + radius : x + width - radius
  const space = radius * 0.5
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        fill={PAPER}
        stroke={LINE}
        strokeWidth={1.8}
      />
      <path
        d={`M ${end - direction * space} ${y + radius} A ${space} ${space} 0 1 ${direction < 0 ? 1 : 0} ${end} ${y + radius + space}`}
        fill="none"
        stroke={LINE}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </g>
  )
}

export function Wig({ top }: { top: number }) {
  return (
    <g>
      <path
        d={`M 56 ${top + 52} Q 54 ${top + 2} 100 ${top - 2} Q 146 ${top + 2} 144 ${top + 52} Z`}
        fill={PAPER}
        stroke={LINE}
        strokeWidth={1.8}
      />
      {[0, 1, 2].map((row) => {
        const y = top + 12 + row * 9
        return (
          <path
            key={row}
            d={`M ${80 - row * 6} ${y + 5} Q 100 ${y - 5} ${120 + row * 6} ${y + 5}`}
            fill="none"
            stroke={LINE}
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.55}
          />
        )
      })}
      {[0, 1, 2].map((row) => {
        const y = top + 50 + row * 15
        const width = 30 - row * 2
        return (
          <g key={row}>
            <Roll
              x={64 - width}
              y={y}
              width={width}
              height={14}
              direction={-1}
            />
            <Roll x={136} y={y} width={width} height={14} direction={1} />
          </g>
        )
      })}
      {[0, 1, 2, 3, 4, 5, 6].map((curl) => {
        const cx = 62 + curl * 12.7
        return (
          <g key={curl}>
            <circle
              cx={cx}
              cy={top + 50}
              r={7}
              fill={PAPER}
              stroke={LINE}
              strokeWidth={1.8}
            />
            <path
              d={`M ${cx - 3.5} ${top + 50} A 3.5 3.5 0 1 1 ${cx + 1} ${top + 53.5}`}
              fill="none"
              stroke={LINE}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </g>
        )
      })}
    </g>
  )
}
