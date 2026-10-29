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
import { mixedTextGroups, type MixedTextGroup } from '@obiter/redaction-policy'
import { DetectionModeWarning } from './detection-mode-warning'
import { useFinalizeRun } from './hooks'
import {
  DETECTION_COVERAGE_CAVEAT,
  categoryLabel,
  decisionCounts,
} from './span-copy'
import type { RedactionRun } from './types'

const outputModeOrder: OutputMode[] = ['redacted', 'pseudonymised']

/**
 * The repeated text a reviewer has decided both ways. Stated with the words
 * that leak, because "2 spans disagree" is not something a reviewer can act on:
 * the group names the text, its category and which occurrence decided what.
 */
function MixedTextBlock({
  groups,
  onShow,
}: {
  groups: MixedTextGroup[]
  onShow: (spanId: string) => void
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-warning-soft p-4 text-meta text-ink"
      role="alert"
    >
      <p className="flex items-start gap-2 text-item">
        <Warning
          className="mt-0.5 shrink-0 text-warning"
          size={16}
          aria-hidden="true"
        />
        {groups.length === 1
          ? 'One piece of text has different decisions.'
          : `${String(groups.length)} pieces of text have different decisions.`}
      </p>
      <p className="text-muted">
        The same words are redacted in one place and kept visible in another, so
        the copy would still show what you decided to remove. Decide each group
        the same way before finalising.
      </p>
      <ul className="flex flex-col gap-2">
        {groups.map((group) => (
          <li
            key={group.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface px-3 py-2"
          >
            <span className="min-w-0 break-words">{group.text}</span>
            <span className="text-caption text-subtle">
              {categoryLabel[group.category]}
            </span>
            <span className="text-caption text-muted tabular-nums">
              {group.removed.length} redacted · {group.kept.length} kept visible
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onShow(group.kept[0] ?? group.removed[0] ?? '')}
            >
              Show them
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
  onShowSpan,
}: {
  run: RedactionRun
  /** Selects one span in the document and the list; absent where the host
   * cannot select one. */
  onShowSpan?: (spanId: string) => void
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
  const mixed =
    /\.docx$/iu.test(run.sourceFilename) ||
    run.sourceMimeType?.includes('wordprocessingml')
      ? []
      : mixedTextGroups(run.spans, run.decisions)
  const blocked =
    undecided > 0 ||
    mixed.length > 0 ||
    Boolean(limitedDetectionMode && !detectionConfirmed) ||
    !pagesReviewed
  const firstUndecided = run.spans.find((span) => !run.decisions[span.id])?.id
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
              {onShowSpan && firstUndecided ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    close()
                    onShowSpan(firstUndecided)
                  }}
                >
                  Show them
                </Button>
              ) : null}
            </div>
          ) : null}

          {mixed.length > 0 ? (
            <MixedTextBlock
              groups={mixed}
              onShow={(spanId) => {
                close()
                onShowSpan?.(spanId)
              }}
            />
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
                {DETECTION_COVERAGE_CAVEAT} I have read the document myself and
                I will check every page of the disclosure copy before it leaves
                the firm.
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
                : mixed.length > 0
                  ? 'Make the repeated text consistent to finalise.'
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
