import { useRef, useState } from 'react'
import { FileText, Plus, Trash, UploadSimple } from '@phosphor-icons/react'
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Input,
  Skeleton,
  StatusDot,
  useToast,
} from '@obiter/ui'
import { PageScaffold, useCurrentUser } from '@obiter/app-shell'
import {
  useCreateRedactionRun,
  useCreateUploadedRedactionRun,
  useDeleteRedactionRun,
  useRedactionRuns,
} from './hooks'
import { categoryLabel, formatDate } from './span-copy'
import type { RedactionRun } from './types'

const ACCEPTED_TYPES =
  '.docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const detectedThings = [
  'person_name',
  'address',
  'date',
  'email',
  'phone',
  'account_number',
  'government_id',
  'national_insurance',
  'organisation_name',
  'case_reference',
] as const satisfies ReadonlyArray<keyof typeof categoryLabel>

const runStatus = {
  pending: { label: 'Waiting to start', tone: 'neutral' },
  detecting: { label: 'Detecting', tone: 'info' },
  ready_for_review: { label: 'Ready for review', tone: 'warning' },
  reviewing: { label: 'In review', tone: 'info' },
  finalized: { label: 'Finalised', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
} satisfies Record<
  RedactionRun['status'],
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
>

function RunRow({
  run,
  canManage,
  onOpenRun,
}: {
  run: RedactionRun
  canManage: boolean
  onOpenRun: (runId: string) => void
}) {
  const deleteRun = useDeleteRedactionRun()
  const { toast } = useToast()
  const status = runStatus[run.status]
  const action =
    run.status === 'finalized'
      ? 'View'
      : run.status === 'failed'
        ? 'Details'
        : 'Continue'
  return (
    <li className="flex items-start justify-between gap-3 border-b border-line px-6 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-item truncate text-ink">{run.sourceFilename}</p>
        <p className="mt-0.5 text-caption text-subtle">
          {run.matterName ?? 'Standalone run'} · {formatDate(run.createdAt)}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusDot tone={status.tone}>{status.label}</StatusDot>
          <span className="text-caption tabular-nums text-muted">
            {run.summary.reviewedCount} of {run.summary.totalSpans} decided
          </span>
        </p>
        {run.status === 'failed' ? (
          <p className="mt-1 text-caption text-danger" role="alert">
            {run.summary.failureReason ??
              'The detector stopped before it finished, so this run found nothing.'}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={run.status === 'finalized' ? 'ghost' : 'secondary'}
          onClick={() => onOpenRun(run.id)}
        >
          {action}
        </Button>
        {canManage ? (
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete run for ${run.sourceFilename}`}
                >
                  <Trash aria-hidden />
                </Button>
              }
            />
            <DialogContent size="md">
              <DialogTitle>Delete redaction run</DialogTitle>
              <DialogDescription>
                This removes the run and its review state. Removals are soft —
                the rows persist for the audit.
              </DialogDescription>
              <div className="flex justify-end gap-2">
                <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                <Button
                  variant="danger"
                  loading={deleteRun.isPending}
                  onClick={async () => {
                    await deleteRun.mutateAsync(run.id)
                    toast({ title: 'Redaction run deleted' })
                  }}
                >
                  Delete run
                </Button>
              </div>
              <DialogCloseButton />
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Start a redaction. Upload leads, because that is what the work is; pasted
 * text is for a short extract and says what it loses. The run list states what
 * each run is doing and what is still undecided, and a failed run says why
 * rather than sitting under a status word.
 */
export function RedactionRunsView({
  onOpenRun,
}: {
  onOpenRun: (runId: string) => void
}) {
  const { data: me } = useCurrentUser()
  const query = useRedactionRuns()
  const create = useCreateRedactionRun()
  const upload = useCreateUploadedRedactionRun()
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [pasting, setPasting] = useState(false)
  const [filename, setFilename] = useState('')
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const busy = create.isPending || upload.isPending

  const submitUpload = (file: File) => {
    if (busy) return
    upload.mutate(file, { onSuccess: ({ run }) => onOpenRun(run.id) })
  }

  const submitPaste = () => {
    if (busy || !filename.trim() || !text) return
    create.mutate(
      { filename, text },
      {
        onSuccess: ({ run }) => {
          setFilename('')
          setText('')
          setPasting(false)
          onOpenRun(run.id)
        },
      },
    )
  }

  return (
    <PageScaffold
      title="Start a redaction"
      description="Choose a document, review every detected span, then finalise a redacted copy."
    >
      <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
            <div>
              <h2 className="text-section text-ink">New redaction run</h2>
              <p className="mt-0.5 text-meta text-muted">
                Detection starts as soon as the document is uploaded.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-4 p-6">
            <div
              className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center ${
                dragging ? 'border-brand bg-raised' : 'border-line-strong'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer.files?.[0]
                if (file) submitUpload(file)
              }}
            >
              <UploadSimple
                size={20}
                aria-hidden="true"
                className="text-muted"
              />
              <p className="text-item text-ink">Drop the document here</p>
              <p className="max-w-[46ch] text-meta text-muted">
                Word documents, PDFs with a text layer, or plain text. The
                document stays where it is; Obiter works on a copy.
              </p>
              <Button
                variant="primary"
                loading={upload.isPending}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                aria-label="Upload a document to redact"
                accept={ACCEPTED_TYPES}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) submitUpload(file)
                  event.target.value = ''
                }}
              />
              <p className="text-caption text-subtle">
                Up to 25 MB · one document at a time
              </p>
            </div>
            {upload.error ? (
              <p className="text-meta text-danger" role="alert">
                The document was not uploaded, so no run was started.{' '}
                {upload.error.message}
              </p>
            ) : null}

            {pasting ? (
              <div className="flex flex-col gap-3 rounded-lg bg-fill p-4">
                <Input
                  label="Source filename"
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  placeholder="submission.txt"
                />
                <label className="flex flex-col gap-2 text-item text-ink">
                  Document text
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={8}
                    placeholder="Paste the text to redact…"
                    className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-meta text-ink"
                  />
                </label>
                {create.error ? (
                  <p className="text-meta text-danger" role="alert">
                    The run was not created. {create.error.message}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    loading={create.isPending}
                    disabled={busy || !filename.trim() || !text}
                    onClick={submitPaste}
                    iconStart={<Plus size={16} aria-hidden="true" />}
                  >
                    Start run from text
                  </Button>
                  <Button variant="ghost" onClick={() => setPasting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPasting(true)}
                >
                  Paste text instead
                </Button>
                <span className="text-caption text-subtle">
                  For a short extract. Formatting and comments are not carried
                  across, and the pages cannot be reviewed as they will print.
                </span>
              </div>
            )}

            <div className="border-t border-line pt-4">
              <h3 className="text-item text-ink">What Obiter looks for</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {detectedThings.map((category) => (
                  <span
                    key={category}
                    className="rounded-sm bg-fill px-2 py-1 text-caption text-muted"
                  >
                    {categoryLabel[category]}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-caption text-subtle">
                Detection finds candidates, not everything sensitive. Scanned
                PDFs without a text layer cannot be redacted reliably, and
                Obiter tells you before a run starts.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
            <span className="text-caption text-subtle">
              The original is never changed.
            </span>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <div className="border-b border-line px-6 py-4">
              <h2 className="text-section text-ink">Recent runs</h2>
            </div>
            {query.isPending ? (
              <div className="flex flex-col gap-2 p-6">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : query.error ? (
              <div className="p-6">
                <EmptyState
                  title="Redaction runs are unavailable"
                  body={query.error.message}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void query.refetch()}
                    >
                      Try again
                    </Button>
                  }
                />
              </div>
            ) : !query.data?.runs.length ? (
              <div className="p-6">
                <EmptyState
                  title="No redaction runs yet"
                  body="Upload a document to start one, or open a document in a matter."
                  icon={<FileText size={28} aria-hidden="true" />}
                />
              </div>
            ) : (
              <ul className="flex flex-col">
                {query.data.runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    canManage={canManage}
                    onOpenRun={onOpenRun}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-line px-6 py-4">
              <h2 className="text-section text-ink">Before you start</h2>
            </div>
            <dl className="flex flex-col gap-4 p-6">
              {[
                ['Original', 'Never overwritten.'],
                [
                  'Decisions',
                  'Each one is recorded with the reviewer and the time.',
                ],
                ['Output', 'Redacted PDF or pseudonymised Word.'],
                [
                  'Schedule',
                  'A separate, access-controlled file. It contains the original redacted text.',
                ],
              ].map(([term, detail]) => (
                <div key={term}>
                  <dt className="text-caption text-subtle">{term}</dt>
                  <dd className="mt-0.5 text-meta text-ink">{detail}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </PageScaffold>
  )
}
