import type { AgentPresence } from '@obiter/contracts'

const GOWN = '#1a2033'
const GOWN_HI = '#2a3350'
const FUR = '#3a3e47'
const PINK = '#e0607e'

export function Gown({ neck = 160 }: { neck?: number }) {
  return (
    <g>
      <path
        d={`M 36 204 Q 34 ${neck + 8} 100 ${neck} Q 166 ${neck + 8} 164 204 Q 164 208 158 208 L 42 208 Q 36 208 36 204 Z`}
        fill={GOWN}
        stroke="#46527a"
        strokeWidth={2.5}
      />
      <path
        d={`M 78 ${neck + 2} Q 70 184 66 208 M 122 ${neck + 2} Q 130 184 134 208`}
        stroke={GOWN_HI}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M 90 ${neck + 1} L 99 ${neck + 1} L 97 ${neck + 30} Q 92 ${neck + 31} 88 ${neck + 28} Z`}
        fill="#fff"
      />
      <path
        d={`M 101 ${neck + 1} L 110 ${neck + 1} L 112 ${neck + 28} Q 108 ${neck + 31} 103 ${neck + 30} Z`}
        fill="#fff"
      />
    </g>
  )
}

export function RolledBrief({
  x,
  y,
  angle,
  scale = 1,
}: {
  x: number
  y: number
  angle: number
  scale?: number
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <rect
        x={-25}
        y={-8.5}
        width={50}
        height={17}
        rx={8.5}
        fill="#f4ecd8"
        stroke="#c9b993"
        strokeWidth={1.6}
      />
      <ellipse
        cx={22}
        cy={0}
        rx={3.4}
        ry={7}
        fill="#e8dcc0"
        stroke="#c9b993"
        strokeWidth={1.4}
      />
      <rect x={-3} y={-9.5} width={6} height={19} rx={1.5} fill={PINK} />
    </g>
  )
}

export function Paw({
  x,
  y,
  className,
}: {
  x: number
  y: number
  className?: string
}) {
  return (
    <ellipse className={className} cx={x} cy={y} rx={10} ry={8} fill={FUR} />
  )
}

function OpenBrief() {
  return (
    <g transform="rotate(-4 100 186)">
      <path
        d="M 64 170 L 136 170 L 140 206 L 60 206 Z"
        fill="#f7f0de"
        stroke="#c9b993"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M 100 170 L 100 206" stroke="#d9cba8" strokeWidth={1.5} />
      {[0, 1, 2, 3].map((line) => (
        <path
          key={line}
          className="ratio-page-line"
          style={{ animationDelay: `${line * 0.3}s` }}
          d={`M 70 ${178 + line * 6.5} L 94 ${178 + line * 6.5} M 106 ${178 + line * 6.5} L ${130 - (line % 2) * 8} ${178 + line * 6.5}`}
          stroke="#8d8270"
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
      <rect x={97} y={168} width={6} height={8} rx={1.5} fill={PINK} />
    </g>
  )
}

export function RatioBody({ state }: { state: AgentPresence }) {
  switch (state) {
    case 'idle':
    case 'done':
      return (
        <g>
          <Gown />
          <g className="ratio-brief">
            <RolledBrief x={146} y={182} angle={-24} />
            <Paw x={138} y={190} />
          </g>
        </g>
      )
    case 'thinking':
      return (
        <g>
          <Gown />
          <RolledBrief x={146} y={186} angle={-60} />
          <Paw x={140} y={196} className="ratio-paw" />
        </g>
      )
    case 'working':
      return (
        <g>
          <Gown />
          <OpenBrief />
          <Paw x={62} y={196} />
          <Paw x={138} y={196} />
        </g>
      )
    case 'needs_approval':
      return (
        <g>
          <Gown />
          <circle
            className="ratio-ring"
            cx={100}
            cy={184}
            r={44}
            fill="none"
            stroke="#e0a43a"
            strokeWidth={3}
          />
          <g className="ratio-offer">
            <RolledBrief x={100} y={184} angle={-8} scale={1.5} />
            <Paw x={64} y={192} />
            <Paw x={136} y={182} />
          </g>
        </g>
      )
    case 'stuck':
      return (
        <g>
          <Gown />
          <RolledBrief x={140} y={196} angle={8} />
          <Paw x={130} y={198} />
        </g>
      )
  }
}
