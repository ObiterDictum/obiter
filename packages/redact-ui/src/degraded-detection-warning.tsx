import { Warning } from '@phosphor-icons/react'

export function DegradedDetectionWarning() {
  return (
    <section
      className="flex gap-3 rounded-md border border-warning bg-surface p-4 text-sm text-ink"
      role="alert"
    >
      <Warning
        className="mt-0.5 shrink-0 text-warning"
        size={20}
        aria-hidden="true"
      />
      <div>
        <p className="font-semibold">Model detection did not run</p>
        <p className="mt-1 text-muted">
          Names, addresses and dates of birth were not automatically detected.
          Check the document manually for these categories before finalising.
        </p>
      </div>
    </section>
  )
}
