import type { AgentPresence } from '@obiter/contracts'
import { Wig } from './wig'

const INK = '#1b2236'
const BLUSH = '#f39aa6'

function Eyes({ state }: { state: AgentPresence }) {
  if (state === 'done')
    return (
      <path
        d="M 76 115 Q 83 107 90 115 M 110 115 Q 117 107 124 115"
        fill="none"
        stroke="#fff"
        strokeWidth={3}
        strokeLinecap="round"
      />
    )
  return (
    <g className="ratio-eyes">
      <circle cx={83} cy={114} r={7.5} fill="#000" />
      <circle cx={117} cy={114} r={7.5} fill="#000" />
      <g className="ratio-pupils">
        <circle cx={85.8} cy={110.8} r={3} fill="#fff" />
        <circle cx={119.8} cy={110.8} r={3} fill="#fff" />
        <circle cx={80.5} cy={117} r={1.2} fill="#fff" opacity={0.8} />
        <circle cx={114.5} cy={117} r={1.2} fill="#fff" opacity={0.8} />
      </g>
    </g>
  )
}

function Brows({ state }: { state: AgentPresence }) {
  if (state === 'needs_approval')
    return (
      <path
        d="M 75 98 Q 83 93 91 97 M 109 97 Q 117 93 125 98"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    )
  if (state === 'stuck')
    return (
      <path
        d="M 76 100 Q 83 101 90 97 M 110 97 Q 117 101 124 100"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    )
  return null
}

function Mouth({ state }: { state: AgentPresence }) {
  switch (state) {
    case 'idle':
      return (
        <path
          d="M 93 157 Q 100 164 107 157"
          fill="none"
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )
    case 'thinking':
      return (
        <path
          d="M 95 159 Q 101 157 106 160"
          fill="none"
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )
    case 'working':
      return (
        <path
          d="M 95 158 Q 100 161 105 158"
          fill="none"
          stroke={INK}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      )
    case 'needs_approval':
      return <ellipse cx={100} cy={159} rx={4} ry={3.6} fill={INK} />
    case 'done':
      return (
        <g>
          <path d="M 91 156 Q 100 167 109 156 Z" fill={INK} />
          <path d="M 96 161 Q 100 165 104 161" fill="#e8737f" />
        </g>
      )
    case 'stuck':
      return (
        <path
          d="M 93 160 Q 97 157 100 160 Q 103 163 107 159"
          fill="none"
          stroke={INK}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      )
  }
}

export function RatioFace({ state }: { state: AgentPresence }) {
  const happy = state === 'done'
  return (
    <g>
      <ellipse cx={58} cy={126} rx={15} ry={28} fill="#9a9ea6" />
      <ellipse cx={142} cy={126} rx={15} ry={28} fill="#9a9ea6" />
      <ellipse cx={100} cy={120} rx={48} ry={46} fill="#f6f3ec" />
      <path
        d="M 66 78 Q 75 74 85 79 Q 93 110 95 138 Q 86 143 79 136 Q 64 106 66 78 Z"
        fill="#23262d"
      />
      <path
        d="M 134 78 Q 125 74 115 79 Q 107 110 105 138 Q 114 143 121 136 Q 136 106 134 78 Z"
        fill="#23262d"
      />
      <Eyes state={state} />
      <Brows state={state} />
      <ellipse
        cx={70}
        cy={140}
        rx={7.5}
        ry={4.5}
        fill={BLUSH}
        opacity={happy ? 0.85 : 0.55}
      />
      <ellipse
        cx={130}
        cy={140}
        rx={7.5}
        ry={4.5}
        fill={BLUSH}
        opacity={happy ? 0.85 : 0.55}
      />
      <ellipse cx={100} cy={148} rx={9.5} ry={7} fill="#23262d" />
      <ellipse cx={97} cy={145.5} rx={3} ry={1.8} fill="#fff" opacity={0.6} />
      <Mouth state={state} />
      <Wig top={30} />
    </g>
  )
}
