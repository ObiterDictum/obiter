import { Button, EmptyState } from '@obiter/ui'
import type { VerificationFindingView } from '@obiter/contracts'
import type { AuthorityHit } from '../../document-authorities'
import { useVerificationWorkspace } from '../verification/verification-context'

/**
 * The list of authorities: distinct citations in the document, each with its
 * citing paragraphs and — where the latest verification run covered it —
 * the finding it produced. The join is strict: a finding only counts for a
 * citation it names, in the paragraph the citation sits in, so a covered
 * entry is never mistaken for checked work it was not. A citation the run
 * did not cover says so rather than borrowing a clean state.
 */
export function DocumentAuthoritiesPanel({
  citations,
  onSelect,
}: {
  citations: readonly AuthorityHit[]
  onSelect: (paragraphId: string) => void
}) {
  const verification = useVerificationWorkspace()
  // First occurrence order keeps the list stable while the document is
  // edited; grouping is by the citation text itself.
  const groups: Array<{ citation: string; hits: AuthorityHit[] }> = []
  for (const hit of citations) {
    const group = groups.find((item) => item.citation === hit.citation)
    if (group) group.hits.push(hit)
    else groups.push({ citation: hit.citation, hits: [hit] })
  }
  const findings = verification?.findings ?? []
  const findingFor = (hit: AuthorityHit) =>
    findings.find(
      (finding) =>
        finding.location.paragraphId === hit.paragraphId &&
        excerptNamesCitation(finding.excerpt, hit.citation),
    )
  const runState = !verification
    ? null
    : verification.findingsPending
      ? 'loading'
      : !verification.run || verification.run.status !== 'completed'
        ? 'none'
        : verification.stale
          ? 'stale'
          : 'current'
  return (
    <aside
      className="flex w-full flex-col gap-4 lg:max-w-sm"
      aria-label="Authorities"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">List of authorities</h3>
        <p className="text-xs leading-relaxed text-muted">
          Citations in this document, grouped by authority.{' '}
          {runState === 'current'
            ? 'States come from the latest verification run.'
            : runState === 'stale'
              ? 'States come from a run over an earlier version — save and verify again to refresh them.'
              : runState === 'loading'
                ? 'Verification findings are still loading.'
                : 'Run Verify citations to check these against the stored sources.'}
        </p>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title="No citations found"
          body="UK and E&W neutral citations in the draft appear here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.citation} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink">
                {group.citation}
                {group.hits.length > 1
                  ? ` — cited ${String(group.hits.length)} times`
                  : ''}
              </span>
              {group.hits.map((hit, index) => (
                <AuthorityRow
                  key={`${hit.paragraphId}-${String(index)}`}
                  hit={hit}
                  finding={findingFor(hit)}
                  onSelect={onSelect}
                  onShowFinding={verification?.openFinding}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/**
 * Whether the finding's excerpt names this citation — a bounded match, so
 * `[2024] UKSC 3` does not borrow the finding `[2024] UKSC 31` produced in
 * the same paragraph.
 */
function excerptNamesCitation(excerpt: string, citation: string) {
  let index = excerpt.indexOf(citation)
  while (index !== -1) {
    const before = excerpt[index - 1]
    const after = excerpt[index + citation.length]
    if (
      (before === undefined || !/[\p{L}\p{N}]/u.test(before)) &&
      (after === undefined || !/[\p{L}\p{N}]/u.test(after))
    ) {
      return true
    }
    index = excerpt.indexOf(citation, index + 1)
  }
  return false
}

const STATE_LABELS = {
  clear: 'Checked',
  flagged: 'Flagged',
  not_checked: 'Not checked',
  review_required: 'Needs review',
} satisfies Record<VerificationFindingView['state'], string>

function AuthorityRow({
  hit,
  finding,
  onSelect,
  onShowFinding,
}: {
  hit: AuthorityHit
  finding: VerificationFindingView | undefined
  onSelect: (paragraphId: string) => void
  onShowFinding?: (findingId: string) => void
}) {
  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="justify-start"
        onClick={() => onSelect(hit.paragraphId)}
      >
        {hit.citation}
      </Button>
      {finding ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-[11px]"
          onClick={() => onShowFinding?.(finding.id)}
        >
          {STATE_LABELS[finding.state]}
        </Button>
      ) : null}
    </span>
  )
}
