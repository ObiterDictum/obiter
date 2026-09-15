import { useState } from 'react'
import { useCurrentUser } from '../../current-user'
import { downloadBlob, selectedParagraphLength } from '../../document-edits'
import {
  documentFormatToolbar,
  formattedModel,
} from '../../document-format-edits'
import { findMatchLabel } from '../../document-find'
import { documentStory } from '../../document-model-text'
import { layoutDocument } from '../../document-page-engine'
import { documentImagePartNames } from '../../document-page-media'
import { documentDefaultFace } from '../../document-page-style'
import { handleDocumentWorkspaceKeys } from '../../document-workspace-keys'
import {
  useDocumentComments,
  useDocumentModel,
  useDocumentTrackedChanges,
  useDocumentCollaborationSync,
  useDocumentImageUrls,
  useResolveDocumentComment,
  useCreateDocumentComment,
  useTrackedChangeDecision,
  fetchDocumentExport,
} from '../../document-workspace-api'
import { extractAuthorities } from '../../document-authorities'
import { DocumentModelPage } from './model-view'
import { DocumentSaveBanners } from './save-banners'
import { InsertAuthorityDialog } from './insert-authority-dialog'
import { DocumentWorkspaceToolbar } from './toolbar'
import { usePublishDocumentDirty } from './document-draft-status'
import { WorkspaceSidePanels } from './workspace-side-panels'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
import { useDocumentSave } from './use-document-save'
import { useWorkspaceDrafts } from './use-workspace-drafts'
import { useWorkspaceCaret } from './use-workspace-caret'
import { VerificationMarkerLayer } from '../verification/verification-marker-layer'
import { DocumentDesk, DocumentPage } from './document-page'
import {
  ConflictBanner,
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
  mutationError,
  type DocumentWorkspaceLayout,
} from './workspace-chrome'

export function DocxWorkspace({
  documentId,
  versionId,
  matterId,
  filename,
  layout = 'page',
}: {
  documentId: string
  versionId: string
  matterId: string
  filename: string
  layout?: DocumentWorkspaceLayout
}) {
  const { data: me } = useCurrentUser()
  const modelQuery = useDocumentModel(documentId)
  const commentsQuery = useDocumentComments(documentId)
  const changesQuery = useDocumentTrackedChanges(documentId)
  const [savedVersion, setSavedVersion] = useState<{
    documentId: string
    versionId: string
  } | null>(null)
  const baseVersionId =
    savedVersion?.documentId === documentId
      ? savedVersion.versionId
      : (modelQuery.data?.versionId ?? versionId)
  const syncQuery = useDocumentCollaborationSync(documentId, baseVersionId)
  const createComment = useCreateDocumentComment(documentId)
  const resolveComment = useResolveDocumentComment(documentId)
  const decideChange = useTrackedChangeDecision(documentId, matterId)
  const drafts = useWorkspaceDrafts({
    organisationId: me?.organisation?.id ?? 'no-organisation',
    userId: me?.user.id ?? 'anonymous',
    documentId,
    baseVersionId: modelQuery.data?.versionId,
  })

  const [zoom, setZoom] = useState(100)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [authoritiesOpen, setAuthoritiesOpen] = useState(false)
  const [insertAuthorityOpen, setInsertAuthorityOpen] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  const model = modelQuery.data?.model
  const presence = syncQuery.data?.participants ?? []
  const remoteChange = syncQuery.data?.changed === true
  const save = useDocumentSave({
    documentId,
    matterId,
    model,
    drafts,
    baseVersionId,
    trackChanges,
    presence,
    currentUserId: me?.user.id,
    remoteChange,
    onSaved: (version) =>
      setSavedVersion(version ? { documentId, versionId: version } : null),
  })

  const painted = model ? formattedModel(model, drafts.format) : undefined
  const pages = painted
    ? layoutDocument(painted, drafts.drafts, drafts.inserts, drafts.extraRuns)
    : []
  const imageUrls = useDocumentImageUrls(
    documentId,
    model ? documentImagePartNames(model) : [],
  )
  // Verification reads the stored version, so it must stay disabled while any
  // work is off-server: editable operations, a blocked or held change, or a
  // recoverable draft. `useDocumentSave` owns that truth as `saveState`; the
  // E45 recovery paths keep it unsaved until the work is actually covered.
  usePublishDocumentDirty(save.saveState.status !== 'saved')
  const {
    selectedParagraphId,
    restoreCaret,
    formatRange,
    setFormatRange,
    verticalCaret,
    cursor,
    findQuery,
    setFindQuery,
    replaceQuery,
    setReplaceQuery,
    findHits,
    activeFindIndex,
    selectParagraph,
    onNextHit,
    onPreviousHit,
    onReplaceOne,
    onReplaceAll,
    insertAuthority,
    undoDocument,
  } = useWorkspaceCaret({ documentId, model, drafts })

  useDocumentPresenceHeartbeat(documentId, cursor, true)
  const authorities = model
    ? extractAuthorities(
        model,
        drafts.drafts,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
      )
    : []

  async function exportDocx() {
    try {
      const { blob, skippedCommentCount } =
        await fetchDocumentExport(documentId)
      downloadBlob(
        /\.docx$/iu.test(filename) ? filename : `${filename}.docx`,
        blob,
      )
      if (skippedCommentCount > 0) {
        setBanner(skippedCommentsMessage(skippedCommentCount))
      }
    } catch (error) {
      setBanner(mutationError(error))
    }
  }

  const transientBanner = save.notice ?? banner

  const ribbon = (
    <WorkspaceRibbon>
      <DocumentWorkspaceToolbar
        kind="docx"
        dirty={save.dirty}
        saving={save.saving}
        trackChanges={trackChanges}
        zoom={zoom}
        commentsOpen={commentsOpen}
        changesOpen={changesOpen}
        authoritiesOpen={authoritiesOpen}
        commentCount={commentsQuery.data?.comments.length ?? 0}
        changeCount={changesQuery.data?.changes.length ?? 0}
        presence={presence}
        currentUserId={me?.user.id}
        canEdit
        canUndo={drafts.canUndo}
        onToggleComments={() => setCommentsOpen((value) => !value)}
        onToggleChanges={() => setChangesOpen((value) => !value)}
        onToggleAuthorities={() => setAuthoritiesOpen((value) => !value)}
        onInsertAuthority={() => setInsertAuthorityOpen(true)}
        onToggleTrackChanges={() => setTrackChanges((value) => !value)}
        onZoom={setZoom}
        onExportText={() => {
          void exportDocx()
        }}
        onSave={save.save}
        onUndo={undoDocument}
        onInsertParagraph={() => {
          if (!selectedParagraphId) return
          selectParagraph(drafts.insertAfter(selectedParagraphId), 0)
        }}
        onDeleteParagraph={() => {
          if (!selectedParagraphId) return
          const selectId = drafts.deleteParagraph(selectedParagraphId)
          if (selectId) selectParagraph(selectId)
        }}
        format={
          painted
            ? documentFormatToolbar(
                painted,
                drafts.format,
                selectedParagraphId,
                drafts.setFormat,
                formatRange ?? undefined,
                trackChanges,
              )
            : undefined
        }
        find={{
          query: findQuery,
          replace: replaceQuery,
          matchLabel: findMatchLabel(activeFindIndex, findHits.length),
          canReplace: findHits.length > 0,
          onQuery: setFindQuery,
          onReplace: setReplaceQuery,
          onNext: onNextHit,
          onPrevious: onPreviousHit,
          onReplaceOne,
          onReplaceAll,
        }}
      />
      <DocumentSaveBanners save={save} drafts={drafts} />
      {save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="The document has changed since editing began."
            actionLabel="Reload"
            onAction={save.reload}
          />
        </div>
      ) : null}
      {remoteChange && save.dirty && !save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="A colleague saved a newer version. Reload before saving, or save to merge disjoint edits."
            actionLabel="Reload"
            onAction={save.reload}
          />
        </div>
      ) : null}
      {transientBanner ? (
        <p className="px-3 pb-2 text-sm text-ink" role="status">
          {transientBanner}
        </p>
      ) : null}
    </WorkspaceRibbon>
  )

  return (
    <WorkspaceShell
      layout={layout}
      onKeyDown={(event) =>
        handleDocumentWorkspaceKeys(event, {
          save: save.save,
          undo: undoDocument,
          focusFind: () => document.getElementById('document-find')?.focus(),
        })
      }
    >
      {modelQuery.isLoading ? (
        <LoadingBlock label="Loading document model" />
      ) : modelQuery.isError ? (
        <QueryError
          error={modelQuery.error}
          fallback="The document model could not be loaded."
        />
      ) : model ? (
        <>
          {ribbon}
          <DocumentDesk>
            <div className="mx-auto flex w-max max-w-full flex-col items-start gap-6 lg:flex-row">
              <div className="flex w-full flex-col gap-6 lg:w-auto">
                {pages.map((laid, index) => (
                  <DocumentPage
                    key={`page-${index + 1}`}
                    zoom={zoom}
                    width={laid.box.widthPx}
                    height={laid.box.heightPx}
                    fontFamily={documentDefaultFace(model.styles).fontFamily}
                  >
                    <DocumentModelPage
                      model={model}
                      pageNumber={index + 1}
                      pageBlocks={laid.blocks}
                      pageFloats={laid.floats}
                      pageTextBoxes={laid.textBoxes}
                      pageColumns={laid.columns}
                      selectedParagraphId={selectedParagraphId}
                      onSelectParagraph={(paragraphId, offset) =>
                        selectParagraph(paragraphId, offset)
                      }
                      onTextSelection={(from, to) =>
                        setFormatRange({ from, to })
                      }
                      drafts={drafts.drafts}
                      onRunTextChange={(runId, text) =>
                        drafts.setDrafts((current) => ({
                          ...current,
                          [runId]: text,
                        }))
                      }
                      editing
                      presence={presence}
                      currentUserId={me?.user.id}
                      inserts={drafts.inserts}
                      deletedParagraphIds={drafts.deletedParagraphIds}
                      imageUrls={imageUrls}
                      onInsertTextChange={(clientId, text) =>
                        drafts.setInserts((current) =>
                          current.map((item) =>
                            item.clientId === clientId
                              ? { ...item, text }
                              : item,
                          ),
                        )
                      }
                      onInsertParagraph={(afterParagraphId) =>
                        selectParagraph(drafts.insertAfter(afterParagraphId), 0)
                      }
                      onDeleteParagraph={(paragraphId) => {
                        const selectId = drafts.deleteParagraph(paragraphId)
                        if (selectId) selectParagraph(selectId)
                      }}
                      onWordEdit={(edit) => {
                        const caret = drafts.handleWordEdit(model, edit)
                        if (caret) {
                          selectParagraph(caret.paragraphId, caret.offset)
                        }
                      }}
                      restoreCaret={restoreCaret}
                      verticalCaret={verticalCaret}
                    />
                  </DocumentPage>
                ))}
              </div>
              <WorkspaceSidePanels
                commentsOpen={commentsOpen}
                changesOpen={changesOpen}
                authoritiesOpen={authoritiesOpen}
                comments={commentsQuery.data?.comments ?? []}
                selectedParagraphId={
                  documentStory(model)?.paragraphs.some(
                    (paragraph) => paragraph.id === selectedParagraphId,
                  )
                    ? selectedParagraphId
                    : null
                }
                selectedParagraphLength={selectedParagraphLength(
                  model,
                  selectedParagraphId,
                )}
                commentsPending={
                  createComment.isPending || resolveComment.isPending
                }
                commentsError={mutationError(
                  createComment.error ?? resolveComment.error,
                )}
                onCreateComment={(input) => {
                  createComment.mutate({
                    body: input.body,
                    anchor: {
                      paragraphId: input.paragraphId,
                      startOffset: 0,
                      endOffset: input.endOffset,
                    },
                  })
                }}
                onResolveComment={(commentId) =>
                  resolveComment.mutate(commentId)
                }
                changes={changesQuery.data?.changes ?? []}
                changesPending={decideChange.isPending || save.saving}
                changesError={mutationError(decideChange.error)}
                onDecideChange={(action, changeId) => {
                  decideChange.mutate({
                    baseVersionId,
                    action,
                    changeIds: [changeId],
                  })
                }}
                authorities={authorities}
                onSelectAuthority={(paragraphId) =>
                  selectParagraph(paragraphId)
                }
              />
            </div>
            <VerificationMarkerLayer model={model} />
          </DocumentDesk>
          <InsertAuthorityDialog
            open={insertAuthorityOpen}
            onOpenChange={setInsertAuthorityOpen}
            disabled={
              !selectedParagraphId && !documentStory(model)?.paragraphs[0]
            }
            onInsert={insertAuthority}
          />
        </>
      ) : null}
    </WorkspaceShell>
  )
}

function skippedCommentsMessage(count: number) {
  return count === 1
    ? '1 comment could not be placed in the exported document and was skipped.'
    : `${count} comments could not be placed in the exported document and were skipped.`
}
