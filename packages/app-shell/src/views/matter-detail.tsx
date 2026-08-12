import { Link, useNavigate } from '@tanstack/react-router'
import { Plus, Trash } from '@phosphor-icons/react'
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
import type { AppPlatform } from '@obiter/contracts'
import { useState } from 'react'
import { DocumentWorkspace } from '../components/document-workspace/workspace'
import { useCurrentUser } from '../current-user'
import { blankDocumentFile } from '../document-blank'
import { useMatterDocuments, useUploadMatterDocument } from '../documents'
import { useDeleteMatter, useMatter } from '../matters'

/** Matter detail — document list plus an in-place viewer/editor. */
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

  function addDocument(file: File) {
    upload.mutate(file, {
      onSuccess: (result) => {
        setSelectedDocumentId(result.document.id)
      },
    })
  }

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
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={upload.isPending}
                loading={upload.isPending}
                iconStart={<Plus size={14} weight="bold" aria-hidden />}
                onClick={() => {
                  void blankDocumentFile()
                    .then(addDocument)
                    .catch((error: unknown) => {
                      toast({
                        title:
                          error instanceof Error
                            ? error.message
                            : 'Could not create the document.',
                        tone: 'danger',
                      })
                    })
                }}
              >
                New
              </Button>
              <label className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-raised">
                {upload.isPending ? 'Uploading…' : 'Upload'}
                <input
                  type="file"
                  accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="sr-only"
                  disabled={upload.isPending}
                  aria-label="Upload document"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) addDocument(file)
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
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
                      aria-current={selected ? 'true' : undefined}
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
                        {version?.documentStatus
                          ? ` · ${version.documentStatus}`
                          : ''}
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
                body="Create a Word document here, or upload a DOCX, text-layer PDF, or TXT file."
              />
            </div>
          )}
        </section>

        <section
          className="flex h-full min-h-0 flex-col overflow-hidden"
          aria-label={selectedDocument ? 'Document' : 'Matter detail'}
        >
          {selectedDocument ? (
            <DocumentWorkspace
              documentId={selectedDocument.id}
              version={selectedDocument.currentVersion}
              layout="pane"
            />
          ) : (
            <div className="flex h-full flex-col gap-4 p-5 sm:p-6">
              {m.description ? (
                <p className="max-w-prose text-sm leading-relaxed text-muted">
                  {m.description}
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted">
                  Select a document to open it here, or create a new one from
                  the list.
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
