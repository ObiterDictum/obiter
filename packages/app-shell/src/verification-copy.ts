import type {
  VerificationFailureCode,
  VerificationFindingDismissal,
  VerificationFindingState,
  VerificationFindingType,
  VerificationFindingView,
  VerificationRun,
  VerificationRunSummary,
} from '@obiter/contracts'
import type { DocumentStoryKind } from '@obiter/contracts'
import type { UnmappedReason } from './components/verification/verification-mapping'

export function verificationStoryLabel(kind: DocumentStoryKind | undefined) {
  switch (kind) {
    case 'document':
      return 'Main document'
    case 'footnotes':
      return 'Footnote'
    case 'endnotes':
      return 'Endnote'
    case 'header':
      return 'Header'
    case 'footer':
      return 'Footer'
    case 'comments':
      return 'Comment'
    default:
      return null
  }
}

export function verificationTypeLabel(type: VerificationFindingType) {
  switch (type) {
    case 'authority_existence':
      return 'Authority'
    case 'citation_resolution':
      return 'Citation'
    case 'quote_fidelity':
      return 'Quotation'
    default: {
      const unhandled: never = type
      return unhandled
    }
  }
}

export function verificationStateLabel(
  finding: Pick<VerificationFindingView, 'type' | 'state'>,
) {
  switch (finding.state) {
    case 'clear':
      switch (finding.type) {
        case 'citation_resolution':
          return 'Citation matches checked source'
        case 'authority_existence':
          return 'Authority is held in the stored sources'
        case 'quote_fidelity':
          return 'Quotation matches checked source'
        default: {
          const unhandled: never = finding.type
          return unhandled
        }
      }
    case 'flagged':
      return 'Flagged'
    case 'review_required':
      return 'Needs review'
    case 'not_checked':
      return 'Not checked'
    default: {
      const unhandled: never = finding.state
      return unhandled
    }
  }
}

export function verificationStateTone(state: VerificationFindingState) {
  switch (state) {
    case 'clear':
      return 'success' as const
    case 'flagged':
      return 'danger' as const
    case 'review_required':
      return 'warning' as const
    case 'not_checked':
      return 'neutral' as const
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

export function verificationWhatCompared(type: VerificationFindingType) {
  switch (type) {
    case 'citation_resolution':
      return 'Compared the citation as written with the citation of the stored source it names.'
    case 'authority_existence':
      return 'Compared the cited authority with the sources Obiter stores.'
    case 'quote_fidelity':
      return 'Compared the quoted words with the text of the stored source.'
    default: {
      const unhandled: never = type
      return unhandled
    }
  }
}

export function verificationUncertainty(
  finding: Pick<VerificationFindingView, 'state'>,
) {
  return finding.state === 'not_checked'
    ? 'This check did not run, so nothing was compared.'
    : null
}

export function verificationAuthority(
  finding: Pick<VerificationFindingView, 'authorityName' | 'authorityLabel'>,
) {
  return finding.authorityName
    ? `${finding.authorityName} ${finding.authorityLabel}`
    : finding.authorityLabel
}

export function verificationUnmappedLabel(reason: UnmappedReason) {
  switch (reason) {
    case 'story_not_in_document':
      return 'Not shown in the document: this finding belongs to a story the open document does not contain.'
    case 'paragraph_not_in_document':
      return 'Not shown in the document: the paragraph it names is not in the open document.'
    case 'range_not_in_document':
      return 'Not shown in the document: the recorded range does not fit the paragraph it names.'
    case 'text_changed_since_check':
      return 'Not shown in the document: the text at this location differs from the text that was checked.'
    case 'range_spans_line_break':
      return 'Not shown in the document: the checked text contains a line break, which the page does not draw as text.'
    case 'range_split_across_fragments':
      return 'Not shown in the document: the checked range crosses a page or column boundary, so the page cannot draw it as one range.'
    case 'rendered_anchor_unavailable':
      return 'Not shown in the document: the page did not render an anchor for this location, so the check cannot be drawn beside it.'
    case 'document_not_mappable':
      return 'Not shown in the document: this file type has no document model, so findings are listed here only.'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

export type VerificationFindingCounts = {
  flagged: number
  needsReview: number
  notChecked: number
  matched: number
  dismissed: number
  total: number
}

export function verificationFindingCounts(
  findings: readonly VerificationFindingView[],
): VerificationFindingCounts {
  const counts: VerificationFindingCounts = {
    flagged: 0,
    needsReview: 0,
    notChecked: 0,
    matched: 0,
    dismissed: 0,
    total: findings.length,
  }
  for (const finding of findings) {
    if (finding.dismissal) counts.dismissed += 1
    if (finding.state === 'flagged') counts.flagged += 1
    else if (finding.state === 'review_required') counts.needsReview += 1
    else if (finding.state === 'not_checked') counts.notChecked += 1
    else counts.matched += 1
  }
  return counts
}

export function verificationSummaryCounts(
  summary: VerificationRunSummary,
): VerificationFindingCounts {
  return {
    flagged: summary.flaggedCount,
    needsReview: summary.reviewRequiredCount,
    notChecked: summary.notCheckedCount,
    matched:
      summary.findingCount -
      summary.flaggedCount -
      summary.reviewRequiredCount -
      summary.notCheckedCount -
      summary.dismissedCount,
    dismissed: summary.dismissedCount,
    total: summary.findingCount,
  }
}

export function verificationCountsLabel(counts: VerificationFindingCounts) {
  const parts: string[] = []
  if (counts.flagged > 0) parts.push(`${counts.flagged} flagged`)
  if (counts.needsReview > 0)
    parts.push(
      `${counts.needsReview} ${counts.needsReview === 1 ? 'needs' : 'need'} review`,
    )
  if (counts.notChecked > 0) parts.push(`${counts.notChecked} not checked`)
  if (counts.matched > 0)
    parts.push(
      `${counts.matched} ${counts.matched === 1 ? 'matches' : 'match'} the checked source`,
    )
  if (counts.dismissed > 0) parts.push(`${counts.dismissed} dismissed`)
  return parts.length > 0 ? parts.join(' · ') : 'No findings'
}

export function verificationRunTimestamp(run: VerificationRun) {
  switch (run.status) {
    case 'completed':
    case 'failed':
      return run.completedAt ?? run.createdAt
    case 'running':
    case 'queued':
      return run.startedAt ?? run.createdAt
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}

export function verificationRunTime(run: VerificationRun) {
  const time = formatRunTime(verificationRunTimestamp(run))
  switch (run.status) {
    case 'completed':
      return run.completedAt ? `Completed ${time}` : `Created ${time}`
    case 'failed':
      return run.completedAt ? `Stopped ${time}` : `Created ${time}`
    case 'running':
    case 'queued':
      return run.startedAt ? `Started ${time}` : `Created ${time}`
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}

export function formatRunTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function verificationFailureTitle(code: VerificationFailureCode) {
  switch (code) {
    case 'model_unavailable':
      return 'The stored document could not be read'
    case 'version_not_ready':
      return 'The version is not ready to be checked'
    case 'execution_failed':
      return 'The run stopped before it finished'
    case 'interrupted':
      return 'The run was interrupted'
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}

export function verificationFailureLabel(code: VerificationFailureCode) {
  switch (code) {
    case 'model_unavailable':
      return 'Nothing was checked for this version, and the document was not changed.'
    case 'version_not_ready':
      return 'Nothing was checked, and the document was not changed.'
    case 'execution_failed':
      return 'No successful result was recorded, and the document was not changed.'
    case 'interrupted':
      return 'No result was recorded. A new run starts from the same version rather than reusing a partial one.'
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}

export function verificationVersionNote(
  checkedVersion: number | undefined,
  currentVersion: number | undefined,
) {
  const checked =
    checkedVersion === undefined
      ? 'an earlier version'
      : `version ${String(checkedVersion)}`
  if (currentVersion === undefined || checkedVersion === currentVersion) {
    return `Checked ${checked}.`
  }
  return `Checked ${checked}. Version ${String(currentVersion)} is stored now, so this result covers the earlier text, not the current one.`
}

export function verificationStoredVersionNote(
  versionNumber: number | undefined,
  options: { unsaved: boolean; stale: boolean },
) {
  const parts = [
    versionNumber === undefined
      ? 'Checked the stored version.'
      : `Checked version ${String(versionNumber)}.`,
  ]
  if (options.stale) {
    parts.push('A newer version is stored, so this evidence is earlier.')
  }
  if (options.unsaved) {
    parts.push(
      'Unsaved edits are not part of the stored version and are not covered by this evidence.',
    )
  }
  return parts.join(' ')
}

export function verificationDismissalRecord(
  dismissal: VerificationFindingDismissal,
  currentUserId: string | undefined,
) {
  const time = formatRunTime(dismissal.dismissedAt)
  const who =
    currentUserId && dismissal.dismissedBy === currentUserId
      ? 'you'
      : (dismissal.dismissedByName ?? 'another reviewer')
  return `Dismissed by ${who} · ${time}`
}
