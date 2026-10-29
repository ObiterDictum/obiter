import { useState } from 'react'
import {
  DownloadSimple,
  Eye,
  FolderOpen,
  ShareNetwork,
  Warning,
} from '@phosphor-icons/react'
import { Badge, Button, Card, Skeleton, StatusDot } from '@obiter/ui'
import { PageScaffold } from '@obiter/app-shell'
import {
  useRedactionOutput,
  useRedactionOutputFile,
  useRedactionScheduleExport,
  useReturnToDocument,
} from './hooks'
import { SaveToMatterDialog } from './save-to-matter-dialog'
import {
  PdfDocumentPreview,
  type PdfPreviewStatus,
} from './pdf-document-preview'
import {
  downloadBlob,
  scheduleFilename,
  shareOrDownload,
} from './output-transfer'
import { formatDateTime } from './span-copy'
import type { RedactionRun } from './types'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const downgradeCopy = {
  tracked_change:
    'Part of this document holds redacted text inside a tracked change, which redaction does not cover. Accept or reject the tracked changes and finalise again. Do not serve this file without checking it first.',
  residual_text:
    'Some redacted text could not be removed from the document safely. Do not serve this file without checking it first.',
  burn_failed:
    'The formatted document could not be produced, so a plain-text file was provided instead. Do not serve this file without checking it first.',
} satisfies Record<string, string>

function formatLabel(mimeType: string, securePdf: boolean) {
  if (mimeType === DOCX_MIME) return 'Word document (.docx)'
  if (mimeType === 'application/pdf')
    return securePdf ? 'PDF, image-only pages' : 'PDF'
  return 'Plain text (.txt)'
}

function exportContents(
  run: RedactionRun,
  mimeType: string,
  securePdf: boolean,
) {
  if (run.summary.outputMode === 'pseudonymised') {
    const editable = mimeType === DOCX_MIME
    return {
      heading: editable ? 'Pseudonymised editable copy' : 'Pseudonymised copy',
      format: editable
        ? `${formatLabel(mimeType, securePdf)}, editable`
        : formatLabel(mimeType, securePdf),
      contents: editable
        ? 'Detected names and other personal details are replaced with consistent category tokens so the document stays editable. It is not a disclosure-safe copy: the token map that reverses it stays restricted and audited.'
        : 'Detected names and other personal details are replaced with consistent category tokens. A text copy loses the document’s formatting. It is not a disclosure-safe copy: the token map that reverses it stays restricted and audited.',
    }
  }
  if (mimeType === DOCX_MIME)
    return {
      heading: 'Redacted Word document',
      format: formatLabel(mimeType, securePdf),
      contents:
        'Accepted text is replaced and the document keeps its formatting. Do not treat a Word copy as disclosure-safe: check every page before serving it.',
    }
  if (mimeType !== 'application/pdf')
    return {
      heading: 'Redacted output',
      format: formatLabel(mimeType, securePdf),
      contents:
        'This copy is plain text: the document’s formatting is not in it. Check every page of the source before sharing it, and finalise again if you need a disclosure-safe copy.',
    }
  if (!securePdf)
    return {
      heading: 'Redacted output',
      format: 'PDF, created before image-only output became the default',
      contents:
        'This copy predates the image-only secure PDF, so Obiter cannot state that its text layer is gone. Check every page before sharing it, and finalise again if you need a disclosure-safe copy.',
    }
  return {
    heading: 'Redacted PDF',
    format: 'PDF, image-only pages',
    contents:
      'Every page is an image: selectable text, fonts, comments, annotations, form fields and attachments are not in the file. Visible text, page layout and the redaction bars are kept.',
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FinalizedOutput({
  run,
  outputQuery,
  onOpenDocument,
}: {
  run: RedactionRun
  outputQuery: ReturnType<typeof useRedactionOutput>
  onOpenDocument?: (target: { matterId: string; documentId: string }) => void
}) {
  const output = outputQuery.data
  const mimeType =
    output?.mimeType ?? run.summary.outputMimeType ?? 'text/plain'
  const securePdf = output?.securePdf ?? run.summary.securePdf ?? false
  const isPdf = mimeType === 'application/pdf'
  const isDocx = mimeType === DOCX_MIME
  const isFile = isPdf || isDocx
  const filename =
    output?.filename ?? run.summary.outputFilename ?? run.sourceFilename
  const fileQuery = useRedactionOutputFile(
    run.id,
    isFile && Boolean(run.outputId),
  )
  const [preview, setPreview] = useState<{
    blob: Blob | null
    status: PdfPreviewStatus
  }>({ blob: null, status: { kind: 'loading' } })
  const copy = exportContents(run, mimeType, securePdf)
  const outputFile = fileQuery.data
  const previewStatus: PdfPreviewStatus =
    outputFile !== undefined && preview.blob === outputFile
      ? preview.status
      : { kind: 'loading' }
  const previewReady = isPdf && previewStatus.kind === 'ready'
  const pageCount =
    previewStatus.kind === 'ready' ? previewStatus.pageCount : null
  const downloadReady = isFile
    ? securePdf
      ? previewReady && Boolean(outputFile)
      : Boolean(outputFile)
    : output?.text != null
  const textBlob = () =>
    new Blob([output?.text ?? ''], { type: 'text/plain;charset=utf-8' })
  const outputBlob = () =>
    isFile && outputFile ? outputFile : output?.text != null ? textBlob() : null

  const returnable =
    run.documentId !== null &&
    run.documentVersionId !== null &&
    isDocx &&
    !run.replacementRunId
  const returned = run.returnedDocumentVersionId ?? null
  const returnToDocument = useReturnToDocument(run.id)
  const schedule = useRedactionScheduleExport(run.id)
  const standalone = run.matterId === null && run.documentId === null
  const exportSchedule = (format: 'pdf' | 'docx' | 'json-shareable') =>
    schedule.mutate(format, {
      onSuccess: (blob) =>
        downloadBlob(
          blob,
          format === 'json-shareable'
            ? 'redaction-audit.json'
            : scheduleFilename(`.${format}`),
        ),
    })
  const exportFailed = outputQuery.error ?? (isFile ? fileQuery.error : null)

  return (
    <PageScaffold
      title="Redaction finalised"
      description={`${run.sourceFilename} is redacted. The disclosure copy and the schedule are separate files, for different audiences.`}
      actions={
        returned ? (
          <>
            <Badge tone="success">Saved to the matter</Badge>
            {onOpenDocument &&
            run.returnedMatterId &&
            run.returnedDocumentId ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onOpenDocument({
                    matterId: run.returnedMatterId!,
                    documentId: run.returnedDocumentId!,
                  })
                }
                iconStart={<FolderOpen size={16} aria-hidden="true" />}
              >
                Open document
              </Button>
            ) : null}
          </>
        ) : standalone ? (
          <SaveToMatterDialog run={run} onOpenDocument={onOpenDocument} />
        ) : returnable ? (
          <Button
            variant="secondary"
            loading={returnToDocument.isPending}
            onClick={() =>
              returnToDocument.mutate({
                baseVersionId: run.documentVersionId!,
              })
            }
            iconStart={<FolderOpen size={16} aria-hidden="true" />}
          >
            Return to document
          </Button>
        ) : null
      }
    >
      {run.summary.outputDowngrade ? (
        <section
          className="flex items-start gap-3 rounded-lg bg-warning-soft p-4 text-body text-ink"
          role="alert"
        >
          <Warning
            className="mt-0.5 shrink-0 text-warning"
            size={18}
            aria-hidden="true"
          />
          <div>
            <p className="text-item">
              {run.summary.outputDowngrade.from === 'docx'
                ? 'Word document unavailable — text file provided instead'
                : 'PDF unavailable — text file provided instead'}
            </p>
            <p className="mt-1 text-muted">
              {downgradeCopy[run.summary.outputDowngrade.reason] ??
                downgradeCopy.burn_failed}
            </p>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="finalised-copy">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="finalised-copy" className="text-section text-ink">
            Disclosure copy
          </h2>
          <span className="text-meta text-muted">{copy.heading}</span>
        </div>
        <Card>
          <div className="flex flex-col gap-6 p-6">
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
              <dl className="flex flex-col gap-3">
                <Detail label="File" value={filename} />
                <Detail label="Format" value={copy.format} />
                <Detail label="Contents" value={copy.contents} />
              </dl>
              <dl className="flex flex-col gap-3">
                <Detail
                  label="Spans decided"
                  value={`${run.summary.reviewedCount} of ${run.summary.totalSpans}`}
                />
                <Detail
                  label="Size"
                  value={outputFile ? formatBytes(outputFile.size) : '—'}
                />
                <Detail
                  label="Last updated"
                  value={formatDateTime(run.updatedAt)}
                />
                <Detail
                  label="Matter"
                  value={
                    run.matterName ??
                    (returned ? 'Saved to a matter' : 'Not filed in a matter')
                  }
                />
              </dl>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!downloadReady}
                onClick={() => {
                  const blob = outputBlob()
                  if (blob) downloadBlob(blob, filename)
                }}
                iconStart={<DownloadSimple size={16} aria-hidden="true" />}
              >
                Download {isPdf ? 'PDF' : isDocx ? 'Word copy' : 'text copy'}
              </Button>
              <Button
                variant="secondary"
                disabled={!downloadReady}
                onClick={() => {
                  void (async () => {
                    const blob = outputBlob()
                    if (blob) await shareOrDownload(blob, filename)
                  })()
                }}
                iconStart={<ShareNetwork size={16} aria-hidden="true" />}
              >
                Share
              </Button>
              {isPdf ? (
                <StatusDot tone={previewReady ? 'success' : 'neutral'}>
                  {pageCount === null
                    ? 'Preview loading'
                    : `Preview ready · ${String(pageCount)} ${pageCount === 1 ? 'page' : 'pages'}`}
                </StatusDot>
              ) : null}
            </div>
            <p className="text-caption text-subtle" role="status">
              {isPdf
                ? 'Check every page of the preview before you download or share this copy.'
                : 'There is no in-app preview for this format. Open the downloaded file and check every page before you share it.'}
            </p>

            {returned ? (
              <p className="text-meta text-muted" role="status">
                Saved as version{' '}
                {returnToDocument.data?.versionNumber ??
                  run.returnedDocumentVersionNumber ??
                  '—'}{' '}
                of the document in the matter; the original version is
                unchanged.
              </p>
            ) : null}
            {returnToDocument.error ? (
              <p className="text-meta text-danger" role="alert">
                {returnToDocument.error.message}
              </p>
            ) : null}

            <div className="border-t border-line pt-6">
              {outputQuery.isPending || (isFile && fileQuery.isPending) ? (
                <Skeleton className="h-40" />
              ) : exportFailed ? (
                <div
                  className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft p-4 text-body text-ink"
                  role="alert"
                >
                  <Warning
                    className="shrink-0 text-danger"
                    size={18}
                    aria-hidden="true"
                  />
                  <p className="min-w-0 flex-1">
                    The copy could not be loaded, so it cannot be downloaded or
                    previewed. {exportFailed.message}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void outputQuery.refetch()
                      if (isFile) void fileQuery.refetch()
                    }}
                  >
                    Try again
                  </Button>
                </div>
              ) : isPdf && outputFile ? (
                <div className="flex flex-col gap-3">
                  <p className="flex items-center gap-2 text-meta text-muted">
                    <Eye size={14} aria-hidden="true" />
                    Preview of the disclosure copy
                  </p>
                  {previewStatus.kind === 'error' ? (
                    <p className="text-meta text-danger" role="alert">
                      The PDF could not be previewed, so the download stays
                      disabled until it loads. This is not the source document.
                    </p>
                  ) : null}
                  <PdfDocumentPreview
                    file={outputFile}
                    onStatusChange={(status) =>
                      setPreview({ blob: outputFile, status })
                    }
                  />
                </div>
              ) : isDocx && outputFile ? (
                <p className="text-body text-muted">
                  The redacted document keeps its formatting. Download it and
                  open it in Word.
                </p>
              ) : (
                <div className="max-w-[68ch] text-body whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                  {output?.text}
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section aria-labelledby="schedule">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="schedule" className="text-section text-ink">
            Redaction schedule
          </h2>
          <span className="text-meta text-muted">
            Separate file · access-controlled
          </span>
        </div>
        <Card>
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-start gap-3 rounded-lg bg-warning-soft p-4 text-body text-ink">
              <Warning
                className="mt-0.5 shrink-0 text-warning"
                size={18}
                aria-hidden="true"
              />
              <p>
                <span className="text-item">
                  The schedule lists decisions, not the words removed.
                </span>{' '}
                Each row names the category, the decision, the reviewer and the
                time, without reproducing the text. Keep it inside the matter;
                it is never part of the disclosure copy.
              </p>
            </div>
            <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Detail label="File" value={scheduleFilename('.pdf')} />
                <Detail
                  label="Decisions"
                  value={`${run.summary.reviewedCount} recorded`}
                />
              </div>
              <div className="flex flex-col gap-3">
                <Detail
                  label="Contents"
                  value="Each decided span with its category, the decision, the reviewer and the time, plus the audit log for this run."
                />
                <Detail
                  label="Access"
                  value="People with access to this run. Opening the export is recorded in the audit log."
                />
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                loading={schedule.isPending && schedule.variables === 'pdf'}
                disabled={schedule.isPending}
                onClick={() => exportSchedule('pdf')}
                iconStart={<DownloadSimple size={16} aria-hidden="true" />}
              >
                Export PDF
              </Button>
              <Button
                variant="secondary"
                loading={schedule.isPending && schedule.variables === 'docx'}
                disabled={schedule.isPending}
                onClick={() => exportSchedule('docx')}
                iconStart={<DownloadSimple size={16} aria-hidden="true" />}
              >
                Export Word
              </Button>
              <Button
                variant="secondary"
                loading={
                  schedule.isPending && schedule.variables === 'json-shareable'
                }
                disabled={schedule.isPending}
                onClick={() => exportSchedule('json-shareable')}
                iconStart={<DownloadSimple size={16} aria-hidden="true" />}
              >
                Export shareable JSON
              </Button>
              <span className="text-caption text-subtle">
                Generated from the audit record.
              </span>
            </div>
            <p className="text-caption text-subtle">
              The shareable JSON holds the counts, categories, decisions,
              reviewers and the output’s SHA-256 — never the words removed or
              the source filename — so it can be given to the other side.
            </p>
            {schedule.error ? (
              <p className="text-meta text-danger" role="alert">
                The schedule was not exported. {schedule.error.message}
              </p>
            ) : null}
          </div>
        </Card>
      </section>

      <p className="text-caption text-subtle">
        The original document and the audit trail are unchanged. The redacted
        copy becomes a version of a matter document only when it is saved to the
        matter.
      </p>
    </PageScaffold>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-subtle">{label}</dt>
      <dd className="mt-0.5 text-body text-ink">{value}</dd>
    </div>
  )
}
