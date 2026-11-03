import { Link, useNavigate } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  StatusDot,
  buttonClassName,
  useToast,
} from '@obiter/ui'
import { DotsThree } from '@obiter/ui/icons'
import type { AppPlatform, CurrentUser } from '@obiter/contracts'
import { useState } from 'react'
import { ApiError } from '../api'
import { ContentFrame } from '../content-frame'
import { useCurrentUser } from '../current-user'
import { useMatterDocuments } from '../documents'
import { useDeleteMatter, useMatter } from '../matters'
import type { MatterRecord } from '../matters'
import { useRedactionRunsList } from '../redaction-runs'
import { PageScaffold } from '../page-scaffold'
import { useOrganisationVerificationRuns } from '../verification-runs'
import { buildAttentionItems } from './home-attention'
import { MatterDocumentsTable } from './matter-documents-table'
import { MatterSavedSources } from './matter-saved-sources'
import { MatterOverview } from './matter-overview'
import { MatterShareControls } from './matter-share-dialog'
import { MatterTransferControls } from './matter-transfer-dialog'
import { openWorkByMatter, openWorkFor } from './matters-rows'
import {
  MatterDropZone,
  MatterUploadButton,
  NewDocumentButton,
} from './matter-upload'
import { ErrorNotice } from './settings-fields'

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
  const redactionRuns = useRedactionRunsList()
  const verification = useOrganisationVerificationRuns(true)

  if (matter.isError && !matter.isLoading) {
    return (
      <EmptyState
        title="Matter not found"
        body="This matter does not exist in your organisation, or your session may have expired."
        action={
          <Link
            to="/matters"
            className={buttonClassName({ variant: 'secondary', size: 'md' })}
          >
            Return to matters
          </Link>
        }
      />
    )
  }

  if (matter.isPending) {
    return (
      <ContentFrame className="flex flex-col gap-6 py-14" aria-busy="true">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-64" />
        <span className="sr-only">Loading the matter…</span>
      </ContentFrame>
    )
  }

  const m = matter.data
  const attention = openWorkByMatter(
    buildAttentionItems({
      verificationRuns: verification.runs,
      redactionRuns: redactionRuns.data?.runs ?? [],
      documentFilenames: new Map(
        (documents.data ?? []).flatMap((document) =>
          document.currentVersion
            ? [[document.id, document.currentVersion.filename] as const]
            : [],
        ),
      ),
      matters: new Map([
        [m.id, { name: m.name, clientReference: m.clientReference }],
      ]),
    }),
  )
  const openWorkUnavailable = verification.isError || redactionRuns.isError
  const attentionReady = verification.isSuccess && redactionRuns.isSuccess
  const attentionTotal = attentionReady ? (attention.get(m.id)?.total ?? 0) : 0
  const isOwner = me.user.id === m.createdBy
  const canManage = me.user.role === 'owner' || me.user.role === 'admin'

  return (
    <PageScaffold
      compact
      title={m.name}
      eyebrow={
        <>
          {m.clientReference ? (
            <span className="font-mono">{m.clientReference}</span>
          ) : null}
          <StatusDot tone={m.status === 'active' ? 'success' : 'neutral'}>
            {m.status === 'active'
              ? 'Active'
              : m.status === 'archived'
                ? 'Archived'
                : 'Deleted'}
          </StatusDot>
        </>
      }
      actions={
        <>
          {documents.data && documents.data.length === 0 ? null : (
            <>
              <MatterUploadButton matterId={m.id} size="sm" />
              <NewDocumentButton matterId={m.id} size="sm" />
            </>
          )}
          {isOwner ? (
            <MatterShareControls
              matter={m}
              organisationId={m.organisationId}
              currentUserId={me.user.id}
              size="sm"
            />
          ) : null}
          {canManage || isOwner ? (
            <MatterActionsMenu
              matter={m}
              user={me.user}
              canDelete={canManage}
              documentCount={documents.data?.length}
            />
          ) : null}
        </>
      }
    >
      <MatterDropZone matterId={m.id}>
        <div className="grid items-start gap-6 @pane-wide:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="matter-documents" className="min-w-0">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="matter-documents" className="text-section text-ink">
                Documents
              </h2>
              <span className="text-meta text-subtle">
                {documents.data
                  ? [
                      `${documents.data.length} ${documents.data.length === 1 ? 'file' : 'files'}`,
                      attentionTotal
                        ? `${attentionTotal} ${attentionTotal === 1 ? 'needs' : 'need'} attention`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : null}
              </span>
            </div>
            <MatterDocumentsTable
              matterId={m.id}
              documents={documents.data}
              loading={documents.isPending}
              error={
                documents.isError
                  ? 'The documents could not be loaded. Check your connection and try again.'
                  : null
              }
            />
          </section>

          <aside aria-label="Matter details" className="flex flex-col gap-6">
            <MatterOverview
              matter={m}
              openWork={attentionReady ? openWorkFor(attention, m.id) : null}
              openWorkUnavailable={openWorkUnavailable}
            />
            <MatterSavedSources matterId={m.id} />
          </aside>
        </div>
      </MatterDropZone>
    </PageScaffold>
  )
}

function MatterActionsMenu({
  matter,
  user,
  canDelete,
  documentCount,
}: {
  matter: MatterRecord
  user: CurrentUser
  canDelete: boolean
  documentCount: number | undefined
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="sm" aria-label="More matter actions">
              <DotsThree size={18} aria-hidden />
            </Button>
          }
        />
        <MenuContent aria-label="Matter actions">
          <MatterTransferControls matter={matter} user={user} as="menu-item" />
          {canDelete ? (
            <MenuItem onClick={() => setDeleteOpen(true)}>
              Delete matter
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      <DeleteMatterDialog
        matterId={matter.id}
        documentCount={documentCount}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  )
}

function DeleteMatterDialog({
  matterId,
  documentCount,
  open,
  onOpenChange,
}: {
  matterId: string
  documentCount: number | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deleteMatter = useDeleteMatter()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [actionError, setActionError] = useState<string | null>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setActionError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Delete matter</DialogTitle>
        <DialogDescription>
          {documentCount === undefined ? (
            'Loading the document count before deletion.'
          ) : (
            <>
              Deleting this matter also removes {documentCount}{' '}
              {documentCount === 1 ? 'document' : 'documents'} and their
              redaction runs. Removals are soft; rows persist for audit and can
              be restored by an operator.
            </>
          )}
        </DialogDescription>
        {actionError ? <ErrorNotice message={actionError} /> : null}
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            loading={deleteMatter.isPending}
            disabled={documentCount === undefined}
            onClick={async () => {
              setActionError(null)
              try {
                await deleteMatter.mutateAsync(matterId)
              } catch (cause) {
                setActionError(
                  cause instanceof ApiError
                    ? cause.message
                    : 'The matter could not be deleted. Try again.',
                )
                return
              }
              toast({ title: 'Matter deleted' })
              await navigate({ to: '/matters' })
            }}
          >
            Delete matter
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
