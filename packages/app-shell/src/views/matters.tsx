import { Link, useNavigate } from '@tanstack/react-router'
import { Folders, Plus, Trash } from '@phosphor-icons/react'
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
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Matters</h1>
          <p className="text-xs text-muted">
            Private workspaces for documents, review, and artifacts
          </p>
        </div>
        <CreateMatterDialog />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showError ? (
          <div className="p-6">
            <EmptyState title="Couldn’t load matters" body={showError} />
          </div>
        ) : list.isLoading ? (
          <MattersListSkeleton />
        ) : data.length > 0 ? (
          <section aria-label="Matters">
            <p className="px-5 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted sm:px-6">
              {data.length} {data.length === 1 ? 'matter' : 'matters'}
            </p>
            <ul className="flex flex-col gap-0.5 px-2 pb-4 sm:px-3">
              {data.map((matter) => (
                <li key={matter.id}>
                  <Link
                    to="/matters/$matterId"
                    params={{ matterId: matter.id }}
                    className="group flex items-center justify-between gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-raised"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-medium text-ink">
                        {matter.name}
                      </strong>
                      <small className="mt-0.5 block truncate text-[11px] text-muted">
                        {matter.clientReference || 'No reference'}
                        {matter.primaryJurisdiction
                          ? ` · ${matter.primaryJurisdiction}`
                          : ''}
                      </small>
                    </span>
                    <Badge
                      tone={matter.status === 'active' ? 'success' : 'neutral'}
                    >
                      {matter.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<Folders aria-hidden="true" size={24} weight="regular" />}
              title="No matters yet"
              body="Create your first matter to start organising legal documents, review state, and artifacts."
              action={
                <CreateMatterDialog trigger="Create your first matter" />
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MattersListSkeleton() {
  return (
    <section
      className="flex flex-col gap-0.5 px-2 pt-3 sm:px-3"
      aria-busy="true"
      aria-label="Loading matters"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5"
        >
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </span>
          <Skeleton className="h-5 w-14 rounded-md" />
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
            size="sm"
            iconStart={<Plus size={14} weight="bold" aria-hidden="true" />}
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
  const { data: me } = useCurrentUser()
  const matter = useMatter(matterId)
  const documents = useMatterDocuments(matterId)
  const upload = useUploadMatterDocument(matterId)
  const deleteMatter = useDeleteMatter()
  const navigate = useNavigate()
  const { toast } = useToast()
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'
  const documentCount = documents.data?.length ?? 0
  const isDocumentCountLoading = documents.isLoading
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  )

  if (matter.isError && !matter.isLoading) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center p-6">
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
      <div className="flex h-full min-h-[24rem] flex-col">
        <div className="border-b border-line px-5 py-3 sm:px-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
          <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
          <div className="p-5">
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    )
  }

  const m = matter.data
  const selectedDocument =
    documents.data?.find((document) => document.id === selectedDocumentId) ??
    null
  const selectedVersion = selectedDocument?.currentVersion

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="min-w-0">
          <Link
            to="/matters"
            className="text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            ← Matters
          </Link>
          <h1 className="mt-1 truncate text-sm font-semibold tracking-tight text-ink sm:text-base">
            {m.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            {m.status}
            {m.clientReference ? ` · ${m.clientReference}` : ''}
            {m.primaryJurisdiction ? ` · ${m.primaryJurisdiction}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
                      redaction runs. Removals are soft; rows persist for audit
                      and can be restored by an operator.
                    </>
                  )}
                </DialogDescription>
                <div className="flex justify-end gap-2">
                  <DialogClose
                    render={<Button variant="ghost">Cancel</Button>}
                  />
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
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <section
          className="min-h-0 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r"
          aria-label="Documents"
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 sm:px-5">
            <p className="text-[11px] font-medium tracking-wide text-muted">
              Documents
            </p>
            <label className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-raised">
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
          <p className="px-4 pb-2 text-[11px] text-subtle sm:px-5">
            DOCX, PDF, and TXT, up to 25 MB
          </p>
          {upload.error ? (
            <p className="px-4 pb-2 text-sm text-danger sm:px-5">
              {upload.error.message}
            </p>
          ) : null}

          {documents.isError ? (
            <div className="p-4">
              <EmptyState
                title="Couldn’t load documents"
                body="Check your connection and try again."
              />
            </div>
          ) : documents.isLoading ? (
            <div className="flex flex-col gap-1 px-2" aria-busy="true">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : documents.data && documents.data.length > 0 ? (
            <ul className="flex flex-col gap-0.5 px-2 pb-3 sm:px-3">
              {documents.data.map((document) => {
                const version = document.currentVersion
                const selected = document.id === selectedDocumentId
                return (
                  <li key={document.id}>
                    <button
                      type="button"
                      className={
                        selected
                          ? 'flex w-full flex-col gap-0.5 rounded-md bg-raised px-2.5 py-2 text-left'
                          : 'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-raised'
                      }
                      onClick={() => setSelectedDocumentId(document.id)}
                    >
                      <span className="truncate text-sm font-medium text-ink">
                        {version?.filename ?? document.logicalKey}
                      </span>
                      <span className="truncate text-[11px] text-muted">
                        {version?.fileType ?? 'Unknown type'}
                        {version ? ` · v${version.versionNumber}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No documents yet"
                body="Upload a DOCX, text-layer PDF, or TXT document to extract text for Redaction."
              />
            </div>
          )}
        </section>

        <section
          className="min-h-0 overflow-y-auto p-5 sm:p-6"
          aria-label={selectedDocument ? 'Document' : 'Matter detail'}
        >
          {selectedDocument ? (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                className="w-fit text-xs font-medium text-muted transition-colors hover:text-ink"
                onClick={() => setSelectedDocumentId(null)}
              >
                ← Matter detail
              </button>
              <header className="border-b border-line pb-4">
                <h2 className="text-base font-semibold text-ink">
                  {selectedVersion?.filename ?? selectedDocument.logicalKey}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {selectedVersion?.fileType ?? 'Unknown type'}
                  {selectedVersion
                    ? ` · Updated v${selectedVersion.versionNumber}`
                    : ''}
                </p>
                <div className="mt-2">
                  <DocumentStatusBadge status={selectedVersion?.documentStatus} />
                </div>
              </header>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/matters/$matterId/documents/$documentId"
                  params={{
                    matterId,
                    documentId: selectedDocument.id,
                  }}
                  className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-pressed"
                >
                  Open document
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[11px] font-medium tracking-wide text-muted">
                Detail
              </p>
              {m.description ? (
                <p className="max-w-prose text-sm leading-relaxed text-muted">
                  {m.description}
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted">
                  Select a document to inspect it, or open it for redaction and
                  review.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>
                  {m.status}
                </Badge>
                <Badge tone="neutral">{m.primaryJurisdiction}</Badge>
              </div>
            </div>
          )}
        </section>
      </div>
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
