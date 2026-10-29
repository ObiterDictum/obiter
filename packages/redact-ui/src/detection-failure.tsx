import { useRef } from 'react'
import { ArrowLeft, ArrowClockwise, Warning } from '@phosphor-icons/react'
import { Button, EmptyState } from '@obiter/ui'
import type { RedactionRun } from './types'

type Format = 'pdf' | 'docx' | 'txt'

function sourceFormat(run: RedactionRun): Format {
  const filename = (run.sourceFilename ?? '').toLowerCase()
  const mimeType = (run.sourceMimeType ?? '').toLowerCase()
  if (mimeType.includes('pdf') || filename.endsWith('.pdf')) return 'pdf'
  if (mimeType.includes('wordprocessingml') || filename.endsWith('.docx'))
    return 'docx'
  return 'txt'
}

const formatWords = {
  pdf: /pdf|text layer|scanned/iu,
  docx: /word|docx/iu,
  txt: /plain text|\.txt/iu,
} satisfies Record<Format, RegExp>

const formatDefaults = {
  pdf: 'Obiter could not read text in this PDF. A scanned document needs OCR, which Obiter does not do yet.',
  docx: 'Obiter could not read this Word document. It may be damaged or use a layout Obiter cannot read. Try another copy of the file.',
  txt: 'Obiter could not read this text file.',
} satisfies Record<Format, string>

/**
 * What a failed detection means for this file. A stored failure reason records
 * what the detector reported, not what the reviewer is holding: an engine
 * message about a PDF text layer on a Word document sends the reviewer looking
 * for the wrong problem, so a reason that names another file format is replaced
 * with copy for the file's own type.
 */
export function detectionFailureMessage(run: RedactionRun) {
  const format = sourceFormat(run)
  const stored = run.summary.failureReason?.trim()
  const namesAnotherFormat =
    stored !== undefined &&
    Object.entries(formatWords).some(
      ([other, pattern]) => other !== format && pattern.test(stored),
    )
  return stored && !namesAnotherFormat ? stored : formatDefaults[format]
}

/**
 * A failed run is not a dead end: the reviewer gets the two things they can do
 * — try a different file, or go back to the run list — instead of a message and
 * nothing else. The upload starts the new run from here, so a failed file does
 * not cost a trip back to the start page.
 */
export function DetectionFailure({
  run,
  onTryAnotherFile,
  uploading = false,
  uploadError = null,
  onBack,
}: {
  run: RedactionRun
  onTryAnotherFile?: (file: File) => void
  uploading?: boolean
  uploadError?: string | null
  onBack?: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <EmptyState
        title="Detection failed"
        body={`${detectionFailureMessage(run)} This run found nothing, so nothing can be finalised from it.`}
        icon={<Warning size={28} aria-hidden="true" />}
        action={
          onTryAnotherFile || onBack ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              {onTryAnotherFile ? (
                <Button
                  variant="primary"
                  loading={uploading}
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  iconStart={<ArrowClockwise size={16} aria-hidden="true" />}
                >
                  Try another file
                </Button>
              ) : null}
              {onBack ? (
                <Button
                  variant="secondary"
                  onClick={onBack}
                  iconStart={<ArrowLeft size={16} aria-hidden="true" />}
                >
                  Back to Redact
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
      />
      {onTryAnotherFile ? (
        <input
          ref={fileRef}
          type="file"
          aria-label="Upload a document to redact"
          accept=".docx,.pdf,.txt"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onTryAnotherFile(file)
            event.target.value = ''
          }}
        />
      ) : null}
      {uploadError ? (
        <p className="mt-4 text-meta text-danger" role="alert">
          The document was not uploaded, so no run was started. {uploadError}
        </p>
      ) : null}
    </>
  )
}

/** Why a run that finished found nothing, per detection mode it ran in. */
export function zeroSpanBody(run: RedactionRun) {
  if (run.detectionMode === 'heuristics+supplement')
    return 'Only the fixed patterns ran: automatic reading of the text did not run, so check the document yourself for names, addresses and dates of birth before finalising.'
  if (run.detectionMode === 'unknown')
    return 'No matching patterns were recorded, and the detection mode is unknown. Check the document yourself for names, addresses and dates of birth before relying on this run.'
  return 'Automatic detection found no matching patterns. Check the document yourself before finalising.'
}
