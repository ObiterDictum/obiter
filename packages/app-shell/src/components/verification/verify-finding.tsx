import { Link } from '@tanstack/react-router'
import {
  CheckCircle,
  Flag,
  Info,
  Question,
  Warning,
} from '@phosphor-icons/react'
import type {
  VerificationEvidenceView,
  VerificationFindingView,
} from '@obiter/contracts'
import { Button, cn, StatusDot } from '@obiter/ui'
import { caseResultLocation } from '../../case-navigation'
import { sourceNameForUrl } from '../search/provenance'
import {
  verificationAuthority,
  verificationDismissalRecord,
  verificationStateLabel,
  verificationStateTone,
  verificationStoryLabel,
  verificationTypeLabel,
  verificationUncertainty,
  verificationWhatCompared,
} from '../../verification-copy'

const markIcon = {
  clear: CheckCircle,
  flagged: Flag,
  review_required: Warning,
  not_checked: Question,
} satisfies Record<VerificationFindingView['state'], typeof CheckCircle>

const markClass = {
  clear: 'text-success',
  flagged: 'text-danger',
  review_required: 'text-warning',
  not_checked: 'text-subtle',
} satisfies Record<VerificationFindingView['state'], string>

/** The in-app source page for one piece of evidence, or null when the store has
 * no record to build one from. Stage 7's pages take the canonical paths. */
function sourceLocation(sourceId: string, canonicalUrl: string) {
  if (canonicalUrl.startsWith('/ln/')) {
    return {
      to: '/ln/$' as const,
      params: { _splat: canonicalUrl.slice('/ln/'.length) },
    }
  }
  return caseResultLocation({ id: sourceId, canonicalUrl })
}

function EvidenceSourceLine({
  evidence,
}: {
  evidence: VerificationEvidenceView
}) {
  const { source } = evidence
  const location = source.canonicalUrl
    ? sourceLocation(evidence.sourceId, source.canonicalUrl)
    : null
  const isProvision = source.canonicalUrl?.startsWith('/ln/') ?? false
  const label = isProvision ? 'provision' : 'judgment'
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-caption text-subtle">
      <span className="text-ink">Checked against</span>
      <span>
        {source.url ? sourceNameForUrl(source.url) : 'Obiter stored source'}
        {source.pinpoint ? ` · ${source.pinpoint}` : ''}
      </span>
      {location ? (
        <Link
          {...location}
          hash={source.anchor ?? undefined}
          className="font-medium text-brand hover:text-brand-pressed"
        >
          Open {label}
        </Link>
      ) : (
        <span>No stored source page for this evidence.</span>
      )}
    </li>
  )
}

/**
 * One finding, with everything a lawyer needs before deciding: the words that
 * were checked, the authority they were attributed to, what was compared, what
 * is uncertain, the source page and its pinpoint, and who dismissed it if
 * somebody did. The state is always stated in words, never by colour alone.
 */
export function VerifyFinding({
  finding,
  currentUserId,
  checkedLabel,
  onDismiss,
  onUndismiss,
  onOpen,
}: {
  finding: VerificationFindingView
  currentUserId: string | undefined
  /** When and against which version the check ran. */
  checkedLabel: string
  onDismiss: () => void
  /** Put a dismissed finding back in the queue. */
  onUndismiss?: () => void
  /** Open the finding beside its text, where the document can show it. */
  onOpen?: () => void
}) {
  const Icon = markIcon[finding.state]
  const story = verificationStoryLabel(finding.location.storyKind)
  const uncertainty = verificationUncertainty(finding)
  const dismissal = finding.dismissal
  // A dismissed finding is settled work: it keeps the outcome the check
  // recorded, and it stops competing for attention with what is still open.
  const settled = dismissal != null
  return (
    <article
      className={cn(
        'flex gap-3 border-t border-line px-6 py-5 first:border-t-0',
        settled && 'bg-fill/40',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-fill',
          settled ? 'text-subtle' : markClass[finding.state],
        )}
      >
        <Icon size={14} weight="fill" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {settled ? (
            <StatusDot tone="neutral">Dismissed</StatusDot>
          ) : (
            <StatusDot tone={verificationStateTone(finding.state)}>
              {verificationStateLabel(finding)}
            </StatusDot>
          )}
          <span className="text-caption text-subtle">
            {verificationTypeLabel(finding.type)}
            {story ? ` · ${story}` : ''}
          </span>
          <span className="ml-auto text-caption text-subtle">
            {checkedLabel}
          </span>
        </div>

        <p
          className={cn(
            'rounded-md bg-fill px-3 py-2 text-body wrap-anywhere',
            settled ? 'text-muted' : 'text-ink',
          )}
        >
          {finding.type === 'quote_fidelity'
            ? `“${finding.excerpt}”`
            : finding.excerpt}
        </p>

        <p className="text-meta text-muted">
          <span className={settled ? 'text-muted' : 'text-ink'}>
            {finding.type === 'quote_fidelity'
              ? 'Attributed to'
              : 'Cited authority'}
            :
          </span>{' '}
          {verificationAuthority(finding)}
        </p>

        <div className="flex flex-col gap-1">
          <p className="text-caption text-subtle">
            {verificationWhatCompared(finding.type)}
          </p>
          <p className="text-meta text-muted">{finding.explanation}</p>
        </div>

        {uncertainty ? (
          <p
            className={`text-meta ${verificationStateTone(finding.state) === 'warning' ? 'text-warning' : 'text-muted'}`}
            role="note"
          >
            {uncertainty}
          </p>
        ) : null}

        {dismissal ? (
          <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-caption">
            <Info
              size={14}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-subtle"
            />
            <span className="text-muted">
              <span className="block text-ink">
                {verificationDismissalRecord(dismissal, currentUserId)}
              </span>
              {dismissal.reason ?? 'No reason given.'}
            </span>
          </div>
        ) : null}

        {finding.evidence.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {finding.evidence.map((evidence) => (
              <EvidenceSourceLine key={evidence.id} evidence={evidence} />
            ))}
          </ul>
        ) : (
          <p className="text-caption text-subtle">
            No source was checked, so there is nothing to open.
          </p>
        )}

        {onOpen || !dismissal || onUndismiss ? (
          <div className="flex flex-wrap items-center gap-2">
            {onOpen ? (
              <Button variant="secondary" size="sm" onClick={onOpen}>
                Open finding
              </Button>
            ) : null}
            {!dismissal && finding.state !== 'clear' ? (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss finding
              </Button>
            ) : null}
            {dismissal && onUndismiss ? (
              <Button variant="ghost" size="sm" onClick={onUndismiss}>
                Reopen finding
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
