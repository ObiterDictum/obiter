import { useEffect, useRef } from 'react'
import { Button, EmptyState } from '@obiter/ui'
import type { CrossReferenceCheck } from '../../document-cross-reference-check'
import type { DefinedTermCheck } from '../../document-defined-terms'
import type { LegalCheckFinding } from '../../document-legal-checks'

/**
 * The stored-markup legal checks: what `REF` fields and `_Def_` defined-term
 * bookmarks say about this document, read from the wire plus pending drafts.
 * Findings are presented as things to look at, never as a verdict — the
 * checks name what they could not read rather than pass it silently.
 */
export function LegalChecksPanel({
  checks,
  focus,
  onSelect,
}: {
  checks: {
    references: CrossReferenceCheck
    terms: DefinedTermCheck
  } | null
  /** The section the ribbon control asked for; scrolled into view. */
  focus: 'terms' | 'references'
  onSelect: (paragraphId: string) => void
}) {
  const termsRef = useRef<HTMLElement>(null)
  const referencesRef = useRef<HTMLElement>(null)
  // Scrolling the requested section into view is a DOM boundary the panel
  // cannot express in state, so the focus prop drives one effect.
  useEffect(() => {
    const target = focus === 'terms' ? termsRef : referencesRef
    target.current?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <aside
      className="flex w-full flex-col gap-4 lg:max-w-sm"
      aria-label="Legal checks"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">Legal checks</h3>
        <p className="text-xs leading-relaxed text-muted">
          Stored fields and defined-term marks, including pending edits.
          Findings name things to review; they are not a verdict on the
          document.
        </p>
      </div>
      {checks === null ? (
        <EmptyState
          title="Checks unavailable"
          body="The document model is still loading."
        />
      ) : (
        <>
          <section ref={termsRef} className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
              Defined terms
            </h4>
            {checks.terms.terms.length > 0 ? (
              <p className="text-xs leading-relaxed text-muted">
                {checks.terms.terms
                  .map((entry) => `${entry.term} (used ${String(entry.uses)}×)`)
                  .join(' · ')}
              </p>
            ) : null}
            <FindingList
              findings={checks.terms.findings}
              empty="No defined-term findings."
              onSelect={onSelect}
            />
          </section>
          <section ref={referencesRef} className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
              Cross-references
            </h4>
            <p className="text-xs leading-relaxed text-muted">
              {checks.references.fields === 0
                ? 'No stored reference fields found.'
                : `${String(checks.references.fields)} reference field${checks.references.fields === 1 ? '' : 's'} checked.`}
              {checks.references.pending > 0
                ? ` ${String(checks.references.pending)} pending.`
                : ''}
            </p>
            <FindingList
              findings={checks.references.findings}
              empty="No cross-reference findings."
              onSelect={onSelect}
            />
          </section>
        </>
      )}
    </aside>
  )
}

function FindingList({
  findings,
  empty,
  onSelect,
}: {
  findings: readonly LegalCheckFinding[]
  empty: string
  onSelect: (paragraphId: string) => void
}) {
  if (findings.length === 0) {
    return <p className="text-xs leading-relaxed text-muted">{empty}</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {findings.map((finding) => (
        <li key={finding.id}>
          {finding.paragraphId === null ? (
            <p className="text-xs leading-relaxed text-ink">
              <FindingLabel finding={finding} />
              {finding.message}
            </p>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start py-1 text-left whitespace-normal"
              onClick={() =>
                finding.paragraphId !== null && onSelect(finding.paragraphId)
              }
            >
              <span className="text-xs leading-relaxed">
                <FindingLabel finding={finding} />
                {finding.message}
              </span>
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function FindingLabel({ finding }: { finding: LegalCheckFinding }) {
  return (
    <span
      className={
        finding.severity === 'issue'
          ? 'font-medium text-danger'
          : 'font-medium text-muted'
      }
    >
      {finding.severity === 'issue' ? 'Check' : 'Review'}
      {finding.pending ? ' (pending)' : ''}
      {': '}
    </span>
  )
}
