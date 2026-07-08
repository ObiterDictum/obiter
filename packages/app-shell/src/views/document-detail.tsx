import { Link, Outlet } from '@tanstack/react-router'
import { ArrowLeft, FileText, Plus } from '@phosphor-icons/react'
import { Badge, Button, EmptyState } from '@obiter/ui'

/**
 * Document detail — the M1 contract route (PRD FR4). Receives route params as
 * props (the web route passes them via Route.useParams()), renders document
 * metadata + a redaction-runs region (list + "Create Redaction Run" CTA), and a
 * child <Outlet/> so feature sub-routes such as redact/$runId nest beneath it.
 *
 * M1 ships the chrome, the runs region's empty state, and the outlet. Real
 * document + run data is wired by M2 (documents) and Redact PRD 2 (runs).
 */
export function DocumentDetailLayoutView({
  matterId,
  documentId,
}: {
  matterId: string
  documentId: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          to="/matters/$matterId"
          params={{ matterId: String(matterId) }}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to matter
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Document</p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
              <FileText size={24} aria-hidden="true" />
              Document {documentId}
            </h1>
            <p className="text-sm text-muted">
              Matter <span className="font-mono text-ink">{matterId}</span>
            </p>
          </div>
          <Badge tone="neutral">Metadata only</Badge>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-ink">Redaction runs</h2>
            <p className="text-sm text-muted">
              Create a run to detect and review sensitive information before this document enters
              AI-assisted workflows.
            </p>
          </div>
          <Button variant="secondary" size="sm" iconStart={<Plus size={16} weight="bold" aria-hidden="true" />}>
            Create redaction run
          </Button>
        </div>
        <EmptyState
          title="No redaction runs yet"
          body="When a run is created it appears here for review. This region is the contract surface the Redact review UI fills in."
        />
      </section>

      {/* Feature sub-routes (e.g. redact/$runId) render here. */}
      <Outlet />
    </div>
  )
}
