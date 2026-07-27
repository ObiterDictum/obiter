import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Trash } from '@phosphor-icons/react'
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Skeleton,
  useToast,
} from '@obiter/ui'
import { PageScaffold, useCurrentUser } from '@obiter/app-shell'
import {
  useCreateRedactionRun,
  useCreateUploadedRedactionRun,
  useDeleteRedactionRun,
  useRedactionRuns,
} from './hooks'

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function RedactionRunsView({
  onOpenRun,
}: {
  onOpenRun: (runId: string) => void
}) {
  const query = useRedactionRuns()
  const create = useCreateRedactionRun()
  const upload = useCreateUploadedRedactionRun()
  const deleteRun = useDeleteRedactionRun()
  const { toast } = useToast()
  const { data: me } = useCurrentUser()
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'
  const [filename, setFilename] = useState('')
  const [text, setText] = useState('')
  const creating = useRef(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  const creationPending =
    creating.current || create.isPending || upload.isPending

  const submit = () => {
    if (creationPending) return
    creating.current = true
    create.mutate(
      { filename, text },
      {
        onSuccess: ({ run }) => {
          creating.current = false
          setFilename('')
          setText('')
          if (mounted.current) onOpenRun(run.id)
        },
        onError: () => {
          creating.current = false
        },
      },
    )
  }

  const submitUpload = (file: File) => {
    if (creationPending) return
    creating.current = true
    upload.mutate(file, {
      onSuccess: ({ run }) => {
        creating.current = false
        if (mounted.current) onOpenRun(run.id)
      },
      onError: () => {
        creating.current = false
      },
    })
  }

  return (
    <PageScaffold eyebrow="Redaction" title="Redaction runs">
      <section
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        aria-label="Start a redaction run"
      >
        <div>
          <h2 className="font-semibold text-ink">Start a standalone run</h2>
          <p className="text-sm text-muted">
            Paste source text to detect and review sensitive information. This
            run is available to your organisation without attaching it to a
            matter.
          </p>
        </div>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Source filename
            <input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="submission.txt"
              className="rounded-md border border-line bg-canvas px-3 py-2 font-normal text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Document text
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={7}
              placeholder="Paste the source document text…"
              className="rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm font-normal text-ink"
            />
          </label>
        </div>
        {create.error ? (
          <p className="text-sm text-danger">{create.error.message}</p>
        ) : null}
        <div className="border-t border-line pt-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Or upload a document
            <span className="text-xs font-normal text-muted">
              DOCX, text-layer PDF, or TXT, up to 25 MB. The file is processed
              as a standalone redaction run; output is text, not a redacted PDF.
            </span>
            <input
              type="file"
              aria-label="Or upload a document"
              accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={creationPending}
              className="block text-sm font-normal text-ink"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) submitUpload(file)
                event.target.value = ''
              }}
            />
          </label>
          {upload.error ? (
            <p className="mt-2 text-sm text-danger">{upload.error.message}</p>
          ) : null}
        </div>
        <div>
          <Button
            variant="primary"
            iconStart={<Plus size={16} aria-hidden="true" />}
            loading={create.isPending}
            disabled={creationPending || !filename.trim() || !text}
            onClick={submit}
          >
            Create redaction run
          </Button>
        </div>
      </section>
      <section
        className="flex flex-col gap-3"
        aria-label="Organisation redaction runs"
      >
        <div>
          <h2 className="font-semibold text-ink">Organisation runs</h2>
          <p className="text-sm text-muted">
            Standalone and matter-linked runs are listed together.
          </p>
        </div>
        {query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : query.error ? (
          <EmptyState
            title="Redaction runs are unavailable"
            body={query.error.message}
          />
        ) : !query.data?.runs.length ? (
          <EmptyState
            title="No redaction runs yet"
            body="Create a standalone run, or create one from a matter document."
            icon={<FileText size={28} aria-hidden="true" />}
          />
        ) : (
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {query.data.runs.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {run.sourceFilename}
                  </p>
                  <p className="text-xs text-muted">
                    Created {formatCreatedAt(run.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {run.matterId ? (
                      <Badge tone="neutral">
                        Matter {run.matterName ?? run.matterId}
                      </Badge>
                    ) : (
                      <Badge tone="info">Standalone</Badge>
                    )}
                    {run.detectionMode === 'heuristics+supplement' ? (
                      <Badge tone="warning">Degraded detection</Badge>
                    ) : run.detectionMode === 'unknown' ? (
                      <Badge tone="warning">Detection mode unknown</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={run.status === 'finalized' ? 'success' : 'info'}>
                    {run.status.replaceAll('_', ' ')}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onOpenRun(run.id)}
                  >
                    Review
                  </Button>
                  {canManage ? (
                    <Dialog>
                      <DialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete redaction run"
                          >
                            <Trash aria-hidden /> Delete
                          </Button>
                        }
                      />
                      <DialogContent size="md">
                        <DialogTitle>Delete redaction run</DialogTitle>
                        <DialogDescription>
                          This removes the run and its review state. Removals
                          are soft — rows persist for audit and can be restored
                          by an operator.
                        </DialogDescription>
                        <div className="flex justify-end gap-2">
                          <DialogClose
                            render={<Button variant="ghost">Cancel</Button>}
                          />
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
              </div>
            ))}
          </div>
        )}
      </section>
    </PageScaffold>
  )
}
