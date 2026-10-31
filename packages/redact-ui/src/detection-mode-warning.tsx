import { useId } from 'react'
import type { ReactNode } from 'react'
import { Warning } from '@obiter/ui/icons'
import type { DetectionMode } from '@obiter/contracts'

type LimitedDetectionMode = Exclude<DetectionMode, 'model+supplement'>

const warningCopy = {
  'heuristics+supplement': {
    title: 'Model detection did not run',
    description:
      'Names, addresses and dates of birth were not automatically detected. Check the document yourself for these categories before finalising.',
  },
  unknown: {
    title: 'Detection mode was not recorded',
    description:
      'Obiter cannot confirm whether model detection ran. Check the document yourself for names, addresses and dates of birth before relying on this output.',
  },
} satisfies Record<LimitedDetectionMode, { title: string; description: string }>

export function DetectionModeWarning({
  detectionMode,
  role = 'note',
  action,
}: {
  detectionMode: LimitedDetectionMode
  role?: 'alert' | 'note'
  action?: ReactNode
}) {
  const titleId = useId()
  const copy = warningCopy[detectionMode]

  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-lg bg-warning-soft p-4 text-meta text-ink"
      role={role}
      aria-labelledby={titleId}
    >
      <Warning
        className="mt-0.5 shrink-0 text-warning"
        size={16}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-item">
          {copy.title}
        </p>
        <p className="mt-1 text-muted">{copy.description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
