import type { AgentPresence } from '@obiter/contracts'

export function RatioExtras({
  state,
  small = false,
}: {
  state: AgentPresence
  small?: boolean
}) {
  switch (state) {
    case 'thinking':
      return (
        <g transform={small ? undefined : 'translate(150 30)'}>
          {[
            small
              ? { cx: 132, cy: 50, r: 4, delay: 0 }
              : { cx: 0, cy: 0, r: 4.5, delay: 0 },
            small
              ? { cx: 144, cy: 42, r: 5, delay: 0.2 }
              : { cx: 13, cy: -6, r: 5.5, delay: 0.2 },
            small
              ? { cx: 156, cy: 34, r: 6, delay: 0.4 }
              : { cx: 28, cy: -14, r: 6.5, delay: 0.4 },
          ].map((dot) => (
            <circle
              key={dot.cx}
              className="ratio-dot"
              style={{ animationDelay: `${dot.delay}s` }}
              cx={dot.cx}
              cy={dot.cy}
              r={dot.r}
              fill="#9aa3bd"
            />
          ))}
        </g>
      )
    case 'needs_approval':
      return small ? (
        <circle
          className="ratio-ring"
          cx={100}
          cy={104}
          r={64}
          fill="none"
          stroke="#e0a43a"
          strokeWidth={3}
        />
      ) : null
    case 'done':
      return (
        <g>
          <g className="ratio-tick">
            <circle
              cx={small ? 148 : 160}
              cy={small ? 40 : 44}
              r={small ? 12 : 15}
              fill="#3f9a6b"
            />
            <path
              d={
                small
                  ? 'M 142 40 L 146.5 44.5 L 154 36'
                  : 'M 153 44 L 158.5 49.5 L 168 39'
              }
              fill="none"
              stroke="#fff"
              strokeWidth={small ? 3.2 : 3.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          {small ? null : (
            <>
              <path
                className="ratio-spark"
                d="M 38 52 l 3 -9 l 3 9 l 9 3 l -9 3 l -3 9 l -3 -9 l -9 -3 Z"
                fill="#e7b84a"
              />
              <path
                className="ratio-spark"
                style={{ animationDelay: '0.15s' }}
                d="M 176 82 l 2 -6 l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 Z"
                fill="#e7b84a"
              />
            </>
          )}
        </g>
      )
    case 'stuck':
      return (
        <path
          className="ratio-drop"
          d="M 148 70 Q 156 82 152 88 Q 146 92 143 86 Q 142 80 148 70 Z"
          fill="#8cc4ea"
          stroke="#5e9cc8"
          strokeWidth={1.4}
        />
      )
    case 'idle':
    case 'working':
      return null
  }
}
