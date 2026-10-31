import { useRef } from 'react'
import { Button, EmptyState } from '@obiter/ui'
import { ArrowLeft, ArrowClockwise, Warning } from '@obiter/ui/icons'
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

export function DetectionFailure({
  run,
  onTryAnotherFile,
  uploading = false,
  uploadError = null,
  onBack,
  onRetry,
  retrying = false,
  retryError,
}: {
  run: RedactionRun
  onTryAnotherFile?: (file: File) => void
  uploading?: boolean
  uploadError?: string | null
  onBack?: () => void
  onRetry?: () => void
  retrying?: boolean
  retryError?: string
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <EmptyState
        title="Detection failed"
        body={`${detectionFailureMessage(run)} This run found nothing, so nothing can be finalised from it.`}
        icon={<Warning size={28} aria-hidden="true" />}
        action={
          onTryAnotherFile || onBack || onRetry ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              {onRetry ? (
                <Button
                  variant="primary"
                  loading={retrying}
                  disabled={retrying}
                  onClick={onRetry}
                >
                  Retry
                </Button>
              ) : null}
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
      {retryError ? (
        <p role="alert" className="mt-4 text-meta text-danger">
          {retryError}
        </p>
      ) : null}
      {uploadError ? (
        <p className="mt-4 text-meta text-danger" role="alert">
          The document was not uploaded, so no run was started. {uploadError}
        </p>
      ) : null}
    </>
  )
}

export function zeroSpanBody(run: RedactionRun) {
  if (run.detectionMode === 'heuristics+supplement')
    return 'Only the fixed patterns ran: automatic reading of the text did not run, so check the document yourself for names, addresses and dates of birth before finalising.'
  if (run.detectionMode === 'unknown')
    return 'No matching patterns were recorded, and the detection mode is unknown. Check the document yourself for names, addresses and dates of birth before relying on this run.'
  return 'Automatic detection found no matching patterns. Check the document yourself before finalising.'
}
