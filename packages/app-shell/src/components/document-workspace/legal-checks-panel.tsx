import { useEffect, useRef } from 'react'
import { Button, EmptyState } from '@obiter/ui'
import type { CrossReferenceCheck } from '../../document-cross-reference-check'
import type { DefinedTermCheck } from '../../document-defined-terms'
import type { LegalCheckFinding } from '../../document-legal-checks'

export function LegalChecksPanel({
  checks,
  focus,
  onSelect,
}: {
  checks: {
    references: CrossReferenceCheck
    terms: DefinedTermCheck
  } | null
  focus: 'terms' | 'references'
  onSelect: (paragraphId: string) => void
}) {
  const termsRef = useRef<HTMLElement>(null)
  const referencesRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const target = focus === 'terms' ? termsRef : referencesRef
    target.current?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-muted">
        Checks defined terms and cross-references in this document.
      </p>
      {checks === null ? (
        <EmptyState
          title="Checks unavailable"
          body="The document model is still loading."
        />
      ) : (
        <>
          <section ref={termsRef} className="flex flex-col gap-1">
            <h4 className="text-item text-ink">Defined terms</h4>
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
            <h4 className="text-item text-ink">Cross-references</h4>
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
    </div>
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
