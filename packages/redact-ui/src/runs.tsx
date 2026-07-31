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
import { useCurrentUser } from '@obiter/app-shell'
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
  const { data: me } = useCurrentUser()
  const query = useRedactionRuns()
  const create = useCreateRedactionRun()
  const upload = useCreateUploadedRedactionRun()
  const deleteRun = useDeleteRedactionRun()
  const { toast } = useToast()
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
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Redact</h1>
          <p className="text-xs text-muted">
            Bundles and review runs for sensitive spans
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <section
          className="min-h-0 overflow-y-auto border-b border-line p-5 lg:border-b-0 lg:border-r"
          aria-label="Start a redaction run"
        >
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
            New run
          </p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Source filename
              <input
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                placeholder="submission.txt"
                className="rounded-md border border-line bg-surface px-3 py-2 font-normal text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Document text
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={8}
                placeholder="Paste the source document text…"
                className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm font-normal text-ink"
              />
            </label>
            {create.error ? (
              <p className="text-sm text-danger">{create.error.message}</p>
            ) : null}
            <Button
              variant="primary"
              iconStart={<Plus size={16} aria-hidden="true" />}
              loading={create.isPending}
              disabled={creationPending || !filename.trim() || !text}
              onClick={submit}
            >
              Create redaction run
            </Button>
            <div className="border-t border-line pt-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                Or upload a document
                <span className="text-xs font-normal text-muted">
                  DOCX, text-layer PDF, or TXT, up to 25 MB.
                </span>
                <input
                  type="file"
                  aria-label="Or upload a document"
                  accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={creationPending}
                  className="mt-1 block text-sm font-normal text-ink"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) submitUpload(file)
                    event.target.value = ''
                  }}
                />
              </label>
              {upload.error ? (
                <p className="mt-2 text-sm text-danger">
                  {upload.error.message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section
          className="min-h-0 overflow-y-auto"
          aria-label="Organisation redaction runs"
        >
          <p className="px-5 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted sm:px-6">
            Organisation runs
          </p>
          {query.isPending ? (
            <div className="flex flex-col gap-1 px-3 pt-1">
              <Skeleton className="h-14 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
            </div>
          ) : query.error ? (
            <div className="p-5">
              <EmptyState
                title="Redaction runs are unavailable"
                body={query.error.message}
              />
            </div>
          ) : !query.data?.runs.length ? (
            <div className="p-5">
              <EmptyState
                title="No redaction runs yet"
                body="Create a standalone run, or create one from a matter document."
                icon={<FileText size={28} aria-hidden="true" />}
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 px-2 pb-4 sm:px-3">
              {query.data.runs.map((run) => (
                <li key={run.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-raised">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onOpenRun(run.id)}
                    >
                      <p className="truncate text-sm font-medium text-ink">
                        {run.sourceFilename}
                      </p>
                      <p className="text-[11px] text-muted">
                        Created {formatCreatedAt(run.createdAt)}
                        {run.matterId
                          ? ` · Matter ${run.matterName ?? run.matterId}`
                          : ' · Standalone'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge
                          tone={run.status === 'finalized' ? 'success' : 'info'}
                        >
                          {run.status.replaceAll('_', ' ')}
                        </Badge>
                        {run.replacementRunId ? (
                          <Badge tone="neutral">Replaced</Badge>
                        ) : run.replacesRunId ? (
                          <Badge tone="info">Re-detection</Badge>
                        ) : null}
                        {run.detectionMode === 'heuristics+supplement' ? (
                          <Badge tone="warning">Degraded detection</Badge>
                        ) : run.detectionMode === 'unknown' ? (
                          <Badge tone="warning">Detection mode unknown</Badge>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
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
                                <Trash aria-hidden />
                              </Button>
                            }
                          />
                          <DialogContent size="md">
                            <DialogTitle>Delete redaction run</DialogTitle>
                            <DialogDescription>
                              This removes the run and its review state.
                              Removals are soft — rows persist for audit.
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
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
