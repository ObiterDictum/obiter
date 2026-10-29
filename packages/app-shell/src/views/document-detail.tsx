import { useState, type ReactNode } from 'react'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, DotsThree, Trash } from '@phosphor-icons/react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  buttonClassName,
  useToast,
} from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import { useDeleteDocument, useDocument } from '../documents'
import { useMatter } from '../matters'
import { ContentFrame } from '../content-frame'
import { DocumentWorkspace } from '../components/document-workspace/workspace'
import { DocumentVersionView } from '../components/document-workspace/document-version-view'
import { documentRedactionRunsId } from '../components/document-workspace/document-actions'

/**
 * Document detail — the contract route (PRD FR4). Receives route params as
 * props and renders the editor, which owns its own header, then the
 * redaction-runs region and a child <Outlet/> so feature sub-routes such as
 * redact/$runId nest beneath it.
 *
 * The editor is the page: it fills the frame below the top bar so the paper
 * and its docked panels scroll independently. The redaction-runs region keeps
 * its place below the editor, where the contract puts it.
 */
export function DocumentDetailLayoutView({
  matterId,
  documentId,
  redactionRunsRegion,
}: {
  matterId: string
  documentId: string
  redactionRunsRegion?: ReactNode
}) {
  const navigate = useNavigate()
  const document = useDocument(documentId)
  const matter = useMatter(matterId)
  // Naming a version the detail query did not return selects nothing — a
  // viewer sees only the current version's row, so historical ids are never
  // selectable from this surface in the first place.
  const [selectedVersionId, setSelectedVersionId] = useState<string>()
  const selectedVersion = document.data?.versions.find(
    (version) => version.id === selectedVersionId,
  )
  const viewingHistorical =
    selectedVersion !== undefined &&
    selectedVersion.documentStatus === 'ready' &&
    selectedVersion.id !== document.data?.document.currentVersionId

  // The document is loaded by id alone; guard against the URL's matterId not
  // matching the document's actual matter. Render not-found rather than show a
  // valid document under the wrong matter's chrome/back-link.
  const loaded = document.data
  const matterMismatch =
    !document.isLoading &&
    !document.isError &&
    loaded !== undefined &&
    loaded.document.matterId !== matterId
  const matterLink = (
    <Link
      to="/matters/$matterId"
      params={{ matterId: String(matterId) }}
      className="min-w-0 truncate text-subtle hover:text-ink"
      title={matter.data?.name}
    >
      {matter.data?.name ?? 'Matter'}
    </Link>
  )

  if (matterMismatch && loaded) {
    return (
      <ContentFrame className="py-14">
        <EmptyState
          title="This document belongs to a different matter"
          body="The document exists, but it is not part of the matter in this URL. Open it from its own matter to see it in the right context."
          action={
            <Link
              className="font-semibold text-brand hover:text-brand-pressed"
              to="/matters/$matterId/documents/$documentId"
              params={{ matterId: loaded.document.matterId, documentId }}
            >
              Open under the correct matter
            </Link>
          }
        />
      </ContentFrame>
    )
  }
  if (document.isError) {
    return (
      <ContentFrame className="py-14">
        <EmptyState
          title="Document not found"
          body="This document does not exist in your organisation, or your session may have expired."
        />
      </ContentFrame>
    )
  }
  if (document.isLoading || !loaded) {
    return (
      <ContentFrame className="py-14">
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading document"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </ContentFrame>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="h-[calc(100dvh-3rem)] min-h-[34rem] shrink-0">
        {viewingHistorical && selectedVersion ? (
          <ContentFrame className="flex h-full flex-col py-8">
            <DocumentVersionView
              documentId={documentId}
              version={selectedVersion}
              onExit={() => setSelectedVersionId(undefined)}
            />
          </ContentFrame>
        ) : (
          <DocumentWorkspace
            documentId={documentId}
            version={loaded.document.currentVersion}
            document={loaded.document}
            versions={loaded.versions}
            onViewVersion={setSelectedVersionId}
            headerLinks={{
              back: (
                <Link
                  to="/matters/$matterId"
                  params={{ matterId: String(matterId) }}
                  aria-label="Back to matter"
                  className={buttonClassName({
                    variant: 'ghost',
                    size: 'sm',
                    className: 'size-7 px-0',
                  })}
                >
                  <ArrowLeft size={16} aria-hidden />
                </Link>
              ),
              matter: matterLink,
            }}
            headerActions={
              <DocumentActionsMenu
                documentId={documentId}
                matterId={matterId}
                onDeleted={() =>
                  navigate({
                    to: '/matters/$matterId',
                    params: { matterId: String(matterId) },
                  })
                }
              />
            }
          />
        )}
      </div>

      <ContentFrame className="flex flex-col gap-4 py-8">
        <section
          id={documentRedactionRunsId}
          tabIndex={-1}
          aria-label="Redaction runs"
          className="flex flex-col gap-3 rounded-lg bg-surface p-6 focus:outline-2 focus:outline-offset-2 focus:outline-brand"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-section text-ink">Redaction runs</h2>
            <p className="text-meta text-muted">
              Create a run to detect and review sensitive information before
              this document enters AI-assisted workflows.
            </p>
          </div>
          {redactionRunsRegion ?? (
            <EmptyState
              title="No redaction runs yet"
              body="When a run is created it appears here for review. This region is the contract surface the Redact review UI fills in."
            />
          )}
        </section>

        {/* Feature sub-routes (e.g. redact/$runId) render here. */}
        <Outlet />
      </ContentFrame>
    </div>
  )
}

/** The document's overflow actions: Delete, behind a confirmation step. */
function DocumentActionsMenu({
  documentId,
  matterId,
  onDeleted,
}: {
  documentId: string
  matterId: string
  onDeleted: () => void
}) {
  const { data: me } = useCurrentUser()
  const { toast } = useToast()
  const deleteDocument = useDeleteDocument()
  const [confirming, setConfirming] = useState(false)
  const canManage = me?.user.role === 'owner' || me?.user.role === 'admin'
  if (!canManage) return null
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="size-7 px-0"
              aria-label="More document actions"
              iconStart={<DotsThree size={16} aria-hidden />}
            />
          }
        />
        <MenuContent aria-label="Document actions">
          <MenuItem onClick={() => setConfirming(true)}>
            <Trash size={16} aria-hidden />
            Delete document
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent size="md">
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            Deleting this document also removes its redaction runs. Removals are
            soft — rows persist for audit and can be restored by an operator.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              variant="danger"
              loading={deleteDocument.isPending}
              onClick={async () => {
                await deleteDocument.mutateAsync({ documentId, matterId })
                toast({ title: 'Document deleted' })
                setConfirming(false)
                onDeleted()
              }}
            >
              Delete document
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
