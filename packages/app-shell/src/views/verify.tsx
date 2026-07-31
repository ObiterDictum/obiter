import { ListChecks } from '@phosphor-icons/react'
import { EmptyState } from '@obiter/ui'

/**
 * Verify mode stub. Chrome is live so the mode tab is honest; verification
 * product work is still on the roadmap.
 */
export function VerifyRouteView() {
  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Verify</h1>
          <p className="text-xs text-muted">Claim and source checking</p>
        </div>
        <span className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-subtle">
          In development
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="border-b border-line p-6 lg:border-b-0 lg:border-r">
          <EmptyState
            icon={<ListChecks size={28} className="text-muted" />}
            title="No verification runs yet"
            body="Verify will list claims from matter documents and check them against sources. This surface is not shipping yet."
          />
        </section>
        <section className="p-6">
          <EmptyState
            title="Source check"
            body="When a claim is selected, source evidence and review status will appear here."
          />
        </section>
      </div>
    </div>
  )
}
