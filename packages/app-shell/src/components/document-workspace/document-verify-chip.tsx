import {
  Button,
  StatusDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@obiter/ui'
import { ArrowClockwise } from '@phosphor-icons/react'
import type { DocumentVersionRecord } from '../../documents'
import {
  useVerificationWorkspace,
  type VerificationWorkspaceValue,
} from '../verification/verification-context'

export type VerifyChip = {
  label: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  /** True only when the run checked the version now on screen. */
  current: boolean
  detail: string
}

function versionNumber(
  versions: DocumentVersionRecord[],
  versionId: string | null | undefined,
) {
  if (!versionId) return undefined
  return versions.find((version) => version.id === versionId)?.versionNumber
}

function checkedLabel(number: number | undefined) {
  return number === undefined
    ? 'an earlier version'
    : `version ${String(number)}`
}

/**
 * The Verify chip, tied to the version it looked at. It reads the same run the
 * panel does, so the two cannot disagree, and it uses the same words as the
 * Verify page: Checked · version N, Check out of date, Run stopped, Checking…,
 * Not checked. A run on an older version says so, so the chip can never read as
 * a check of the document on screen.
 */
export function verifyChipState(
  verification: VerificationWorkspaceValue,
  versions: DocumentVersionRecord[],
): VerifyChip {
  const { run } = verification
  if (verification.startPending) {
    return {
      label: 'Checking…',
      tone: 'info',
      current: false,
      detail: 'Verification is starting against the stored version.',
    }
  }
  if (!run) {
    return {
      label: 'Not checked',
      tone: 'neutral',
      current: false,
      detail:
        'No verification run exists for this document. Running Verify checks citations, quotations and held authorities against stored sources.',
    }
  }
  const number = versionNumber(versions, run.documentVersionId)
  const version = checkedLabel(number)
  const stale = verification.stale || run.stale
  if (run.status === 'queued' || run.status === 'running') {
    return {
      label: 'Checking…',
      tone: 'info',
      current: false,
      detail: `Verification is running against ${version}. The result stays with that stored version.`,
    }
  }
  if (run.status === 'failed') {
    return {
      label: `Run stopped · ${version}`,
      tone: 'danger',
      current: false,
      detail: stale
        ? `The check of ${version} stopped before it finished, and the text on screen has changed since.`
        : `The check of ${version} stopped before it finished. Nothing was assessed; run Verify again.`,
    }
  }
  const { flaggedCount, reviewRequiredCount, notCheckedCount } = run.summary
  // Nothing was compared if every finding is unchecked; that is not a pass.
  const matchedCount =
    run.summary.findingCount -
    notCheckedCount -
    run.summary.dismissedCount -
    flaggedCount -
    reviewRequiredCount
  if (
    notCheckedCount > 0 &&
    flaggedCount === 0 &&
    reviewRequiredCount === 0 &&
    matchedCount <= 0
  ) {
    return {
      label: `Nothing checked · ${version}`,
      tone: 'warning',
      current: false,
      detail: `The run finished without checking anything in ${version}. Nothing was confirmed or refuted.`,
    }
  }
  const tone =
    flaggedCount > 0
      ? 'danger'
      : reviewRequiredCount > 0 || notCheckedCount > 0
        ? 'warning'
        : 'success'
  if (stale) {
    return {
      label: `Check out of date · ${version}`,
      tone: 'warning',
      current: false,
      detail: `${version[0]?.toUpperCase() ?? ''}${version.slice(1)} was checked, but the text on screen has changed since. Edits are not covered by that run.`,
    }
  }
  const counts =
    flaggedCount > 0
      ? ` · ${String(flaggedCount)} flagged`
      : reviewRequiredCount > 0
        ? ` · ${String(reviewRequiredCount)} need review`
        : notCheckedCount > 0
          ? ` · ${String(notCheckedCount)} not checked`
          : ''
  return {
    label: `Checked · ${version}${counts}`,
    tone,
    current: true,
    detail:
      counts.length > 0
        ? 'Open the findings to see what needs attention.'
        : 'The check ran and found nothing to flag. That is not a statement of legal correctness.',
  }
}

/**
 * The editor header's Verify chip. It reads the same verification context the
 * dock renders, so the two cannot disagree about which version was checked.
 */
export function DocumentVerifyChip({
  versions,
  onOpen,
}: {
  versions: DocumentVersionRecord[]
  /** Opens the docked Verify panel, which holds the findings and Run. */
  onOpen: () => void
}) {
  const verification = useVerificationWorkspace()
  if (!verification) return null
  if (verification.runsPending) {
    return <span className="text-caption text-subtle">Checking…</span>
  }
  if (verification.runsError) {
    return (
      <span className="text-caption text-warning">
        Verification unavailable
      </span>
    )
  }
  const chip = verifyChipState(verification, versions)
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          aria-label={`Verify: ${chip.label}. ${chip.detail}`}
          onClick={onOpen}
        >
          <StatusDot tone={chip.tone} className="text-caption text-ink">
            {chip.label}
          </StatusDot>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{chip.detail}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The header's Check citations control. It starts the same run the panel's control does,
 * through the same availability gate, and opens the panel so the run's
 * progress, failure or result is never hidden behind a closed panel.
 */
export function VerifyRunButton({ onOpen }: { onOpen: () => void }) {
  const verification = useVerificationWorkspace()
  if (!verification) return null
  if (verification.runsPending) return null
  const running = verification.startPending
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={!verification.startAvailability.available && !running}
      loading={running}
      aria-label="Check citations"
      onClick={() => {
        onOpen()
        verification.startRun()
      }}
      iconStart={<ArrowClockwise size={14} aria-hidden />}
    >
      <span className="max-compact:sr-only">Check citations</span>
    </Button>
  )
}

/**
 * Why the header's Run control is unavailable, in the same words the panel
 * uses. It is the one state the chip cannot carry: unsaved edits, a loading
 * status, or a document that is not ready.
 */
export function VerifyRunReason() {
  const verification = useVerificationWorkspace()
  if (!verification || verification.runsPending) return null
  const availability = verification.startAvailability
  if (availability.available) return null
  return (
    <span className="text-caption text-warning" role="note">
      {availability.reason.charAt(0).toUpperCase() +
        availability.reason.slice(1)}
    </span>
  )
}
