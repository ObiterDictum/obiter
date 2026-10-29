import { Button, EmptyState } from '@obiter/ui'
import type { VerificationFindingView } from '@obiter/contracts'
import type { AuthorityHit } from '../../document-authorities'
import { useVerificationWorkspace } from '../verification/verification-context'

type AuthorityGroup = {
  citation: string
  name: string | null
  hits: AuthorityHit[]
  finding: VerificationFindingView | undefined
}

export function DocumentAuthoritiesPanel({
  citations,
  onSelect,
}: {
  citations: readonly AuthorityHit[]
  onSelect: (paragraphId: string) => void
}) {
  const verification = useVerificationWorkspace()
  const groups: AuthorityGroup[] = []
  for (const hit of citations) {
    const group = groups.find((item) => item.citation === hit.citation)
    if (group) group.hits.push(hit)
    else
      groups.push({
        citation: hit.citation,
        name: null,
        hits: [hit],
        finding: undefined,
      })
  }
  const findings = verification?.findings ?? []
  for (const group of groups) {
    group.finding = findings.find(
      (finding) =>
        group.hits.some(
          (hit) =>
            finding.location.paragraphId === hit.paragraphId &&
            excerptNamesCitation(finding.excerpt, group.citation),
        ) &&
        (finding.authorityLabel === group.citation ||
          excerptNamesCitation(finding.excerpt, group.citation)),
    )
    group.name =
      group.finding?.authorityName ??
      findings.find(
        (finding) =>
          finding.authorityLabel === group.citation && finding.authorityName,
      )?.authorityName ??
      null
  }
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
    <div className="flex flex-col gap-4">
      <p className="text-caption text-muted">
        Citations in this document, one row per authority.{' '}
        {runState === 'current'
          ? 'States come from the latest verification run.'
          : runState === 'stale'
            ? 'States come from a run over an earlier version — save and check citations again to refresh them.'
            : runState === 'loading'
              ? 'Verification findings are still loading.'
              : 'Check citations to compare these against the stored sources.'}
      </p>
      {groups.length === 0 ? (
        <EmptyState
          title="No citations found"
          body="UK and E&W neutral citations in the draft appear here."
        />
      ) : (
        <ul className="flex flex-col">
          {groups.map((group) => (
            <AuthorityRow
              key={group.citation}
              group={group}
              onSelect={onSelect}
              onShowFinding={verification?.openFinding}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

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
  group,
  onSelect,
  onShowFinding,
}: {
  group: AuthorityGroup
  onSelect: (paragraphId: string) => void
  onShowFinding?: (findingId: string) => void
}) {
  const first = group.hits[0]
  const title = group.name ? `${group.name} ${group.citation}` : group.citation
  return (
    <li className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto justify-start py-0 text-left whitespace-normal"
        onClick={() => first && onSelect(first.paragraphId)}
      >
        <span className="text-body text-ink">{title}</span>
      </Button>
      <span className="flex flex-wrap items-center gap-2 text-caption text-subtle">
        <span>
          {group.hits.length === 1
            ? 'Cited once'
            : `Cited ${String(group.hits.length)} times`}
        </span>
        {group.finding ? (
          <>
            <span aria-hidden>·</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 text-caption"
              onClick={() => onShowFinding?.(group.finding!.id)}
            >
              {STATE_LABELS[group.finding.state]}
            </Button>
          </>
        ) : (
          <>
            <span aria-hidden>·</span>
            <span>Not checked</span>
          </>
        )}
      </span>
    </li>
  )
}
