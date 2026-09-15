import { Badge } from '@obiter/ui'
import type { VerificationFindingView } from '@obiter/contracts'
import {
  verificationReasonLabel,
  verificationStateLabel,
  verificationStateTone,
  verificationStoryLabel,
  verificationTypeLabel,
} from '../verification-copy'

/**
 * The full findings list. It is the evidence index: every persisted finding is
 * listed with its outcome and evidence, and one the document cannot show beside
 * the text carries the reason it is not shown rather than disappearing.
 */
export function VerificationFindingsList({
  findings,
  notes,
}: {
  findings: VerificationFindingView[]
  /** Finding id to the reason it is not shown beside the document text. */
  notes?: Map<string, string>
}) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted">
        This run finished and found nothing to list. That is not a statement of
        legal correctness.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {findings.map((finding) => (
        <li key={finding.id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{verificationTypeLabel(finding.type)}</Badge>
            {verificationStoryLabel(finding.location.storyKind) ? (
              <Badge tone="neutral">
                {verificationStoryLabel(finding.location.storyKind)}
              </Badge>
            ) : null}
            <Badge tone={verificationStateTone(finding.state)}>
              {verificationStateLabel(finding.state)}
            </Badge>
            {finding.severity ? (
              <Badge tone="neutral">Severity {finding.severity}</Badge>
            ) : null}
            {finding.confidence ? (
              <Badge tone="neutral">Confidence {finding.confidence}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-ink">{finding.explanation}</p>
          <p className="text-sm text-ink">
            <span className="text-xs font-medium tracking-wider text-subtle uppercase">
              Draft excerpt
            </span>
            <span className="mt-0.5 block font-mono text-xs">
              {finding.excerpt}
            </span>
          </p>
          <p className="text-sm text-muted">
            Authority: {finding.authorityLabel}
          </p>
          {notes?.get(finding.id) ? (
            <p className="text-xs text-muted" role="note">
              {notes.get(finding.id)}
            </p>
          ) : null}
          {finding.reviewReason ? (
            <p className="text-sm text-muted">
              {verificationReasonLabel(finding.reviewReason)}
            </p>
          ) : null}
          {finding.evidence.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {finding.evidence.map((item) => (
                <li key={item.id} className="text-xs text-muted">
                  Evidence {item.label}
                  <span className="mt-0.5 block font-mono text-[11px] text-subtle">
                    {item.id}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No source evidence attached.</p>
          )}
        </li>
      ))}
    </ul>
  )
}
