import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Folders, Plus, Trash } from '@phosphor-icons/react'
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
  Input,
  Skeleton,
  useToast,
} from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import {
  mattersListQueryOptions,
  useCreateMatter,
  useDeleteMatter,
  useMatter,
  useMattersList,
  type CreateMatterInput,
} from '../matters'
import { useCurrentUser } from '../current-user'
import { useMatterDocuments, useUploadMatterDocument } from '../documents'

/**
 * Matters list — backed by GET /api/matters via TanStack Query. Loading, empty,
 * and error states use @obiter/ui (Skeleton, EmptyState). Matter creation posts
 * to the real API and appears in the list via cache invalidation.
 */
export function MattersRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const list = useMattersList()
  const data = list.data ?? []

  const showError =
    list.isError && !list.isLoading
      ? 'Matters could not be loaded. Check your connection and try again.'
      : null

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Matters
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Matters
          </h1>
          <p className="mt-1 text-sm text-muted">
            Private workspaces for legal documents, review state, deadlines, and
            artifacts.
          </p>
        </div>
        <CreateMatterDialog />
      </header>

      {showError ? (
        <EmptyState title="Couldn’t load matters" body={showError} />
      ) : list.isLoading ? (
        <MattersListSkeleton />
      ) : data.length > 0 ? (
        <section className="flex flex-col gap-2.5" aria-label="Matters">
          {data.map((matter) => (
            <Link
              key={matter.id}
              to="/matters/$matterId"
              params={{ matterId: matter.id }}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas text-ink">
                  <Folders aria-hidden="true" size={17} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-ink">
                    {matter.name}
                  </strong>
                  <small className="mt-0.5 block truncate text-xs text-muted">
                    {matter.clientReference || 'No reference'}
                    {matter.primaryJurisdiction
                      ? ` · ${matter.primaryJurisdiction}`
                      : ''}
                  </small>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge
                  tone={matter.status === 'active' ? 'success' : 'neutral'}
                >
                  {matter.status}
                </Badge>
                <ArrowRight
                  aria-hidden="true"
                  size={15}
                  weight="bold"
                  className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <EmptyState
          icon={<Folders aria-hidden="true" size={24} weight="regular" />}
          title="No matters yet"
          body="Create your first matter to start organising legal documents, review state, and artifacts."
          action={<CreateMatterDialog trigger="Create your first matter" />}
        />
      )}
    </div>
  )
}

function MattersListSkeleton() {
  return (
    <section
      className="flex flex-col gap-2.5"
      aria-busy="true"
      aria-label="Loading matters"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-line bg-surface p-4"
        >
          <span className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <span className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </span>
          </span>
          <Skeleton className="h-6 w-16 rounded-pill" />
        </div>
      ))}
    </section>
  )
}

function CreateMatterDialog({
  trigger = 'Create matter',
}: {
  trigger?: string
}) {
  const { toast } = useToast()
  const createMatter = useCreateMatter()
  const [name, setName] = useState('')
  const [clientReference, setClientReference] = useState('')
  const [primaryJurisdiction, setPrimaryJurisdiction] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!name.trim() || !primaryJurisdiction.trim()) {
      setError('Matter name and primary jurisdiction are required.')
      return
    }

    const input: CreateMatterInput = {
      name: name.trim(),
      primaryJurisdiction: primaryJurisdiction.trim(),
      clientReference: clientReference.trim() || undefined,
    }

    try {
      const matter = await createMatter.mutateAsync(input)
      toast({
        title: 'Matter created',
        description: `"${matter.name}" is ready.`,
        tone: 'success',
      })
      setName('')
      setClientReference('')
      setPrimaryJurisdiction('')
    } catch {
      setError('Could not create the matter. Please try again.')
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="primary"
            iconStart={<Plus size={16} weight="bold" aria-hidden="true" />}
          >
            {trigger}
          </Button>
        }
      />
      <DialogContent size="md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <DialogTitle>Create a matter</DialogTitle>
            <DialogDescription>
              Matters are private workspaces scoped to your organisation.
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <Input
            label="Matter name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Acme Ltd v Beta Corp"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Client reference"
              value={clientReference}
              onChange={(event) => setClientReference(event.target.value)}
              placeholder="e.g. ACME-2026-001"
            />
            <Input
              label="Primary jurisdiction"
              required
              value={primaryJurisdiction}
              onChange={(event) => setPrimaryJurisdiction(event.target.value)}
              placeholder="e.g. England & Wales"
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <DialogClose
              render={
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" loading={createMatter.isPending}>
              Create matter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Matter detail — backed by GET /api/matters/:id and its documents list. */
export function MatterRouteView({
  matterId,
  platform: _platform,
}: {
  matterId: string
  platform: AppPlatform
}) {
  const matter = useMatter(matterId)
  const documents = useMatterDocuments(matterId)
  const upload = useUploadMatterDocument(matterId)
  const deleteMatter = useDeleteMatter()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: me } = useCurrentUser()
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'
  const documentCount = documents.data?.length ?? 0
  const isDocumentCountLoading = documents.isLoading

  if (matter.isError && !matter.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[760px]">
        <EmptyState
          title="Matter not found"
          body="This matter does not exist in your organisation, or your session may have expired."
          action={
            <Link
              className="font-semibold text-brand hover:text-brand-pressed"
              to="/matters"
            >
              Return to matters
            </Link>
          }
        />
      </div>
    )
  }

  if (matter.isLoading || !matter.data) {
    return (
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    )
  }

  const m = matter.data

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/matters"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
        >
          ← Matters
        </Link>
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {m.clientReference || 'No reference'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {m.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>
            {m.status}
          </Badge>
          <Badge tone="neutral">{m.primaryJurisdiction}</Badge>
        </div>
      </div>

      {canManage ? (
        <Dialog>
          <DialogTrigger
            render={
              <Button variant="ghost" size="sm" aria-label="Delete matter">
                <Trash aria-hidden /> Delete
              </Button>
            }
          />
          <DialogContent size="md">
            <DialogTitle>Delete matter</DialogTitle>
            <DialogDescription>
              {isDocumentCountLoading ? (
                <>Loading the document count before deletion.</>
              ) : (
                <>
                  Deleting this matter also removes {documentCount}{' '}
                  {documentCount === 1 ? 'document' : 'documents'} and their
                  redaction runs. Removals are soft; rows persist for audit and
                  can be restored by an operator.
                </>
              )}
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button variant="ghost">Cancel</Button>} />
              <Button
                variant="danger"
                loading={deleteMatter.isPending}
                disabled={isDocumentCountLoading}
                onClick={async () => {
                  await deleteMatter.mutateAsync(matterId)
                  toast({ title: 'Matter deleted' })
                  navigate({ to: '/matters' })
                }}
              >
                Delete matter
              </Button>
            </div>
            <DialogCloseButton />
          </DialogContent>
        </Dialog>
      ) : null}

      {m.description ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="leading-relaxed text-muted">{m.description}</p>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Documents</h2>
            <p className="text-xs text-subtle">
              DOCX, PDF, and TXT, up to 25 MB
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">
            {upload.isPending ? 'Uploading…' : 'Upload document'}
            <input
              type="file"
              accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) upload.mutate(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>
        {upload.error ? (
          <p className="text-sm text-danger">{upload.error.message}</p>
        ) : null}

        {documents.isError ? (
          <EmptyState
            title="Couldn’t load documents"
            body="Check your connection and try again."
          />
        ) : documents.isLoading ? (
          <div className="flex flex-col gap-2.5" aria-busy="true">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : documents.data && documents.data.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {documents.data.map((document) => {
              const version = document.currentVersion
              return (
                <li key={document.id}>
                  <Link
                    to="/matters/$matterId/documents/$documentId"
                    params={{ matterId, documentId: document.id }}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3.5 transition-colors hover:border-line-strong"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-ink">
                        {version?.filename ?? document.logicalKey}
                      </span>
                      <span className="truncate text-xs text-muted">
                        {version?.fileType ?? 'Unknown type'}
                        {version ? ` · v${version.versionNumber}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <DocumentStatusBadge status={version?.documentStatus} />
                      <ArrowRight
                        aria-hidden="true"
                        size={14}
                        weight="bold"
                        className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState
            title="No documents yet"
            body="Upload a DOCX, text-layer PDF, or TXT document to extract text for Redaction."
          />
        )}
      </section>
    </div>
  )
}

function DocumentStatusBadge({ status }: { status?: string }) {
  if (!status) return null
  const tone =
    status === 'ready' ? 'success' : status === 'failed' ? 'danger' : 'info'
  return <Badge tone={tone}>{status}</Badge>
}

export { mattersListQueryOptions }
