import { useId } from 'react'
import type { ReactNode } from 'react'
import { Warning } from '@phosphor-icons/react'
import type { DetectionMode } from '@obiter/contracts'

type LimitedDetectionMode = Exclude<DetectionMode, 'model+supplement'>

const warningCopy: Record<
  LimitedDetectionMode,
  { title: string; description: string }
> = {
  'heuristics+supplement': {
    title: 'Model detection did not run',
    description:
      'Names, addresses and dates of birth were not automatically detected. Check the document manually for these categories before finalising.',
  },
  unknown: {
    title: 'Detection mode was not recorded',
    description:
      'We cannot confirm whether model detection ran. Check the document manually for names, addresses and dates of birth before relying on this output.',
  },
}

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
    <section
      className="flex flex-wrap items-start gap-3 border-b border-warning/40 bg-raised/40 px-5 py-3 text-sm text-ink sm:px-6"
      role={role}
      aria-labelledby={titleId}
    >
      <Warning
        className="mt-0.5 shrink-0 text-warning"
        size={18}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="font-semibold">
          {copy.title}
        </p>
        <p className="mt-1 text-muted">{copy.description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  )
}
