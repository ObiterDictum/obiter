import { Link, useNavigate } from '@tanstack/react-router'
import { DotsThree } from '@phosphor-icons/react'
import type { AppPlatform } from '@obiter/contracts'
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
import { useState } from 'react'
import { ContentFrame } from '../content-frame'
import { useCurrentUser } from '../current-user'
import { useMatterDocuments } from '../documents'
import { useDeleteMatter, useMatter } from '../matters'
import { useRedactionRunsList } from '../redaction-runs'
import { PageScaffold } from '../page-scaffold'
import { useOrganisationVerificationRuns } from '../verification-runs'
import { buildAttentionItems } from './home-attention'
import { MatterDocumentsTable } from './matter-documents-table'
import { MatterOverview } from './matter-overview'
import { MatterShareControls } from './matter-share-dialog'
import { openWorkByMatter, openWorkFor } from './matters-rows'
import {
  MatterDropZone,
  MatterUploadButton,
  NewDocumentButton,
} from './matter-upload'

/**
 * Matter — the matter's documents, its facts, and what is waiting in it, from
 * reads the shell already makes. Deleting lives in the overflow menu, as the
 * mock-up has it: a destructive action is never the only thing in a header.
 */
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
  // Only the matter's owner may read or change its access list; only an owner
  // or administrator of the organisation may delete the matter.
  const isOwner = me.user.id === m.createdBy
  const canManage = me.user.role === 'owner' || me.user.role === 'admin'

  return (
    <PageScaffold
      eyebrow={
        <span className="flex flex-wrap items-center gap-2">
          {/* Every domain the matter is filed under, not just the first: a
              matter spanning two areas was reading as one. */}
          {m.legalDomains.map((domain) => (
            <span
              key={domain}
              className="inline-flex h-6 items-center rounded-sm bg-fill px-2 text-caption text-muted"
            >
              {domain}
            </span>
          ))}
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
        </span>
      }
      title={m.name}
      description={m.description ?? undefined}
      actions={
        <>
          {/* An empty matter shows these in its EmptyState instead, so the same
              two controls never appear twice on one page. */}
          {documents.data && documents.data.length === 0 ? null : (
            <>
              <MatterUploadButton matterId={m.id} />
              <NewDocumentButton matterId={m.id} />
            </>
          )}
          {isOwner ? (
            <MatterShareControls matter={m} organisationId={m.organisationId} />
          ) : null}
          {canManage ? (
            <MatterActionsMenu
              matterId={m.id}
              documentCount={documents.data?.length}
            />
          ) : null}
        </>
      }
    >
      <MatterDropZone matterId={m.id}>
        <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="matter-documents">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 id="matter-documents" className="text-section text-ink">
                Documents
              </h2>
              <span className="text-meta text-subtle">
                {documents.data
                  ? [
                      `${documents.data.length} ${documents.data.length === 1 ? 'file' : 'files'}`,
                      attentionReady && attention.get(m.id)?.total
                        ? `${attention.get(m.id)?.total} needs attention`
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

          <aside aria-label="Matter details">
            <MatterOverview
              matter={m}
              openWork={attentionReady ? openWorkFor(attention, m.id) : null}
              openWorkUnavailable={openWorkUnavailable}
            />
          </aside>
        </div>
      </MatterDropZone>
    </PageScaffold>
  )
}

/**
 * The matter's actions that are not a primary job of this page. Only delete is
 * here today: there is no archive or export endpoint, and editing the record is
 * not part of this stage.
 */
function MatterActionsMenu({
  matterId,
  documentCount,
}: {
  matterId: string
  documentCount: number | undefined
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="md" aria-label="More matter actions">
              <DotsThree size={18} aria-hidden />
            </Button>
          }
        />
        <MenuContent aria-label="Matter actions">
          <MenuItem onClick={() => setDeleteOpen(true)}>Delete matter</MenuItem>
        </MenuContent>
      </Menu>
      <DeleteMatterDialog
        matterId={matterId}
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            loading={deleteMatter.isPending}
            disabled={documentCount === undefined}
            onClick={async () => {
              await deleteMatter.mutateAsync(matterId)
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
