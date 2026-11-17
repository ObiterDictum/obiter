import type { AgentPresence } from '@obiter/contracts'
import { cn } from './lib/cn'
import { RatioBody } from './ratio/body'
import { RatioExtras } from './ratio/extras'
import { RatioFace } from './ratio/face'
import { useReducedMotion } from './ratio/use-reduced-motion'

const stateWords = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  needs_approval: 'needs approval',
  done: 'done',
  stuck: 'stuck',
} satisfies Record<AgentPresence, string>

export interface RatioMascotProps {
  state: AgentPresence
  size?: number
  label?: string
  live?: boolean
}

export function RatioMascot({
  state,
  size = 64,
  label = `Ratio, ${stateWords[state]}`,
  live = true,
}: RatioMascotProps) {
  const reducedMotion = useReducedMotion()
  const small = size < 40
  const animates = live && !reducedMotion
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={small ? size * 1.13 : size * 1.23}
      viewBox={small ? '32 22 136 154' : '0 0 200 246'}
      data-state={state}
      data-variant={small ? 'small' : 'full'}
      data-motion={animates ? 'animated' : 'still'}
      className={cn(
        'ratio-mascot shrink-0',
        small && 'ratio-mascot--small',
        animates ? 'ratio-mascot--live' : 'ratio-mascot--still',
        `ratio-mascot--${state}`,
      )}
    >
      <g key={state} className="ratio-pose">
        {small ? (
          <>
            <g transform="rotate(-6 100 150)">
              <g className="ratio-head">
                <RatioFace state={state} />
              </g>
            </g>
            <RatioExtras state={state} small />
          </>
        ) : (
          <>
            <g className="ratio-body">
              <RatioBody state={state} />
            </g>
            <g transform="rotate(-6 100 150)">
              <g className="ratio-head">
                <RatioFace state={state} />
              </g>
            </g>
            <RatioExtras state={state} />
          </>
        )}
      </g>
    </svg>
  )
}
