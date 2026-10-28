import { useState } from 'react'
import { DownloadSimple, Lock, Warning } from '@phosphor-icons/react'
import type { OutputMode } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  StatusDot,
} from '@obiter/ui'
import { DetectionModeWarning } from './detection-mode-warning'
import { useFinalizeRun } from './hooks'
import { decisionCounts } from './span-copy'
import type { RedactionRun } from './types'

const outputModeOrder: OutputMode[] = ['redacted', 'pseudonymised']

const outputModes = {
  redacted: {
    title: 'Redacted PDF',
    body: 'For disclosure outside the firm. Every page is an image, with the accepted text removed rather than covered by a box over live text.',
  },
  pseudonymised: {
    title: 'Pseudonymised Word',
    body: 'Names are replaced with consistent category tokens so the document stays editable. Internal work only; the token map stays restricted and audited.',
  },
} satisfies Record<OutputMode, { title: string; body: string }>

/**
 * Finalise. Every gate on this dialog is a disclosure decision the reviewer has
 * to make deliberately: undecided spans block the action rather than being
 * waved through, a limited detection mode has to be acknowledged, and the
 * reviewer confirms they have checked every page themselves, because detection
 * cannot see everything.
 */
export function FinalizeDialog({
  run,
  onShowUndecided,
}: {
  run: RedactionRun
  /** Moves the reviewer to the first undecided span; absent where the host
   * cannot select one. */
  onShowUndecided?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [outputMode, setOutputMode] = useState<OutputMode>('redacted')
  const [detectionConfirmed, setDetectionConfirmed] = useState(false)
  const [pagesReviewed, setPagesReviewed] = useState(false)
  const finalize = useFinalizeRun(run.id)
  const counts = decisionCounts(run.spans, run.decisions)
  const undecided =
    run.spans.length - counts.accepted - counts.rejected - counts.pseudonymised
  const limitedDetectionMode =
    run.detectionMode === 'model+supplement' ? null : run.detectionMode
  const blocked =
    undecided > 0 ||
    Boolean(limitedDetectionMode && !detectionConfirmed) ||
    !pagesReviewed
  const close = () => {
    setOpen(false)
    setDetectionConfirmed(false)
    setPagesReviewed(false)
  }
  const submit = () => {
    if (blocked) return
    finalize.mutate(
      {
        outputMode,
        ...(limitedDetectionMode === 'heuristics+supplement'
          ? { degradedDetectionAcknowledged: true }
          : limitedDetectionMode === 'unknown'
            ? { unknownDetectionAcknowledged: true }
            : {}),
      },
      { onSuccess: close },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : close())}
    >
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        iconStart={<Lock size={16} aria-hidden="true" />}
      >
        Finalise
      </Button>
      <DialogContent size="lg">
        <DialogTitle>Finalise this redaction?</DialogTitle>
        <DialogDescription>
          {run.sourceFilename} · {run.summary.totalSpans} detected spans.
        </DialogDescription>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <StatusDot tone="success">
              {`${String(counts.accepted)} redacted`}
            </StatusDot>
            <StatusDot tone="neutral">
              {`${String(counts.rejected)} kept visible`}
            </StatusDot>
            {counts.pseudonymised > 0 ? (
              <StatusDot tone="info">
                {`${String(counts.pseudonymised)} pseudonymised`}
              </StatusDot>
            ) : null}
            <StatusDot tone={undecided > 0 ? 'warning' : 'neutral'}>
              {`${String(undecided)} undecided`}
            </StatusDot>
          </div>

          {undecided > 0 ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft p-4 text-meta text-ink"
              role="alert"
            >
              <Warning
                className="shrink-0 text-warning"
                size={16}
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1">
                {undecided === 1
                  ? '1 detected span has no decision yet.'
                  : `${undecided} detected spans have no decision yet.`}{' '}
                Obiter will not finalise a run with undecided spans: an
                undecided span is not the same as a span you chose to keep.
              </p>
              {onShowUndecided ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    close()
                    onShowUndecided()
                  }}
                >
                  Show them
                </Button>
              ) : null}
            </div>
          ) : null}

          {limitedDetectionMode ? (
            <DetectionModeWarning
              detectionMode={limitedDetectionMode}
              role="alert"
            />
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-item text-ink">Output</legend>
            {outputModeOrder.map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 hover:bg-hover has-checked:border-line-strong has-checked:bg-raised"
              >
                <input
                  type="radio"
                  className="mt-1"
                  name="redaction-output-mode"
                  checked={outputMode === mode}
                  onChange={() => setOutputMode(mode)}
                />
                <span className="min-w-0">
                  <span className="block text-item text-ink">
                    {outputModes[mode].title}
                  </span>
                  <span className="mt-1 block text-meta text-muted">
                    {outputModes[mode].body}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="rounded-lg bg-fill p-4 text-meta text-muted">
            <p className="text-item text-ink">
              {outputMode === 'redacted'
                ? 'What the disclosure copy contains'
                : 'What the editable copy contains'}
            </p>
            <p className="mt-1">
              {outputMode === 'redacted'
                ? 'One image-only PDF per page: selectable text, fonts, comments, annotations, form fields and attachments are not in the file. Visible text, page layout and the redaction bars are kept.'
                : 'A Word document with the accepted text replaced by consistent category tokens, keeping its formatting so it stays editable.'}
            </p>
            <p className="mt-2">
              The redaction schedule is a separate, access-controlled file and
              is never part of the copy you download here.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {limitedDetectionMode ? (
              <label className="flex items-start gap-3 rounded-lg border border-warning p-4 text-meta text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={detectionConfirmed}
                  onChange={(event) =>
                    setDetectionConfirmed(event.target.checked)
                  }
                />
                {limitedDetectionMode === 'heuristics+supplement'
                  ? 'I acknowledge that model detection did not run, and I have checked the document myself for names, addresses and dates of birth.'
                  : 'I acknowledge that the detection mode was not recorded, and I have checked the document myself for names, addresses and dates of birth.'}
              </label>
            ) : null}
            <label className="flex items-start gap-3 rounded-lg border border-line p-4 text-meta text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={pagesReviewed}
                onChange={(event) => setPagesReviewed(event.target.checked)}
              />
              <span>
                <span className="block text-item text-ink">
                  I have reviewed every page
                </span>
                Detection finds candidates, not everything sensitive. I have
                read the document myself and I will check every page of the
                disclosure copy before it leaves the firm.
              </span>
            </label>
          </div>

          {finalize.error ? (
            <p className="text-meta text-danger" role="alert">
              The redaction was not finalised. {finalize.error.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-caption text-subtle">
              {undecided > 0
                ? `${undecided} still undecided.`
                : pagesReviewed
                  ? 'Ready to finalise.'
                  : 'Confirm the page review to finalise.'}
            </p>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              variant="primary"
              loading={finalize.isPending}
              disabled={blocked}
              onClick={submit}
              iconStart={<DownloadSimple size={16} aria-hidden="true" />}
            >
              {outputMode === 'redacted'
                ? 'Finalise redacted PDF'
                : 'Finalise pseudonymised copy'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
