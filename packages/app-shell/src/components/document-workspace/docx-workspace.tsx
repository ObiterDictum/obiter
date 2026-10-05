import { useState } from 'react'
import { useCurrentUser } from '../../current-user'
import { selectedParagraphLength } from '../../document-edits'
import {
  documentFormatToolbar,
  type FormatTarget,
} from '../../document-format-edits'
import { findMatchLabel } from '../../document-find'
import { documentStory } from '../../document-model-text'
import { documentBreakToolbar } from '../../document-break-toolbar'
import { documentDefaultFace } from '../../document-page-style'
import { handleDocumentWorkspaceKeys } from '../../document-workspace-keys'
import {
  useDocumentComments,
  useDocumentModel,
  useDocumentTrackedChanges,
  useDocumentCollaborationSync,
  useResolveDocumentComment,
  useCreateDocumentComment,
  useTrackedChangeDecision,
} from '../../document-workspace-api'
import { DocumentModelPage } from './model-view'
import { DocumentSaveBanners } from './save-banners'
import { InsertAuthorityDialog } from './insert-authority-dialog'
import { DocumentWorkspaceToolbar } from './toolbar'
import { usePublishDocumentDirty } from './document-draft-status'
import { WorkspaceSidePanels } from './workspace-side-panels'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
import { useDocumentSave } from './use-document-save'
import { useWorkspaceDerivations } from './use-workspace-derivations'
import { useWorkspaceDrafts } from './use-workspace-drafts'
import { useWorkspaceCaret } from './use-workspace-caret'
import { documentClipboardToolbar } from './use-workspace-clipboard'
import { exportDocumentAsDocx } from './document-workspace-export'
import { selectionAnnouncement } from './document-workspace-status'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import { VerificationMarkerLayer } from '../verification/verification-marker-layer'
import { DocumentDesk, DocumentPage, DocumentPrintStyle } from './document-page'
import { useDocumentPrint } from './use-document-print'
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
  const model = modelQuery.data?.model
  const drafts = useWorkspaceDrafts({
    organisationId: me?.organisation?.id ?? 'no-organisation',
    userId: me?.user.id ?? 'anonymous',
    documentId,
    baseVersionId: modelQuery.data?.versionId,
    baseVersionNumber: modelQuery.data?.versionNumber,
    modelError: modelQuery.isError,
    model,
  })

  const [zoom, setZoom] = useState(100)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [authoritiesOpen, setAuthoritiesOpen] = useState(false)
  const [insertAuthorityOpen, setInsertAuthorityOpen] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const { printBanner, printDocument } = useDocumentPrint()

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

  const { painted, pages, authorities, imageUrls, deleteParagraphReason } =
    useWorkspaceDerivations({ documentId, model, drafts })

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
    selectionActive,
    selectionDirection,
    selectionSegments,
    selectionNotice,
    selectAll,
    extendSelection,
    collapseSelection,
    focusParagraph,
    moveCaret,
    rejectSelectionInput,
    reportJoinRefusal,
    blurParagraph,
    replaceSelectionRange,
    splitSelectionRange,
    copySelection,
    cutSelection,
    copyToClipboard,
    cutToClipboard,
    pasteText,
    pasteFromClipboard,
    clearSelection,
    mirrorSelection,
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
    redoDocument,
  } = useWorkspaceCaret({ documentId, model, drafts })

  useDocumentPresenceHeartbeat(documentId, cursor, true)
  // The toolbar acts on the document selection's ranges, or on the caret's
  // own paragraph when there is none.
  const formatTarget: FormatTarget = selectionActive
    ? { kind: 'selection', ranges: [...selectionSegments.values()] }
    : {
        kind: 'caret',
        paragraphId: selectedParagraphId ?? '',
        from: formatRange?.from ?? 0,
        to: formatRange?.to ?? 0,
      }
  const selectionHandlers: ParagraphSelectionHandlers = {
    active: selectionActive,
    direction: selectionDirection,
    onExtend: extendSelection,
    onCollapse: collapseSelection,
    onSelectAll: selectAll,
    onReplaceRange: replaceSelectionRange,
    onDeleteRange: () => replaceSelectionRange(''),
    onSplitRange: splitSelectionRange,
    onCopyRange: copySelection,
    onCutRange: cutSelection,
    onPasteText: (paragraphId, text, from, to) =>
      pasteText(text, { paragraphId, from, to }),
    onClear: clearSelection,
    onRejectInput: rejectSelectionInput,
    onEscapeBlur: blurParagraph,
  }
  // Print reports only refusal or absence; printing itself saves nothing.
  const transientBanner = printBanner ?? save.notice ?? banner
  const format = painted
    ? documentFormatToolbar(
        painted,
        drafts.format,
        selectedParagraphId,
        drafts.setFormat,
        formatTarget,
        trackChanges,
        drafts.drafts,
        drafts.extraRuns,
      )
    : undefined
  const ribbon = (
    <WorkspaceRibbon>
      <DocumentWorkspaceToolbar
        kind="docx"
        dirty={save.dirty}
        saving={save.saving}
        blocked={save.saveState.status === 'blocked'}
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
        {...documentBreakToolbar({
          paragraphId: selectedParagraphId,
          model: painted ?? model,
          offset: formatRange?.to ?? 0,
          selectionActive,
          trackChanges,
          setBreaks: drafts.setBreaks,
        })}
        canUndo={drafts.canUndo}
        canRedo={drafts.canRedo}
        onToggleComments={() => setCommentsOpen((value) => !value)}
        onToggleChanges={() => setChangesOpen((value) => !value)}
        onToggleAuthorities={() => setAuthoritiesOpen((value) => !value)}
        onInsertAuthority={() => setInsertAuthorityOpen(true)}
        onToggleTrackChanges={() => setTrackChanges((value) => !value)}
        onZoom={setZoom}
        onExportText={() => {
          void exportDocumentAsDocx(documentId, filename).then((message) => {
            if (message) setBanner(message)
          })
        }}
        onPrint={printDocument}
        onSave={save.save}
        onUndo={undoDocument}
        onRedo={redoDocument}
        onInsertParagraph={() => {
          if (!selectedParagraphId) return
          selectParagraph(drafts.insertAfter(selectedParagraphId), 0)
        }}
        onDeleteParagraph={() => {
          if (!selectedParagraphId) return
          const { selectId } = drafts.deleteParagraph(selectedParagraphId)
          if (selectId) selectParagraph(selectId)
        }}
        deleteParagraphReason={deleteParagraphReason}
        format={format}
        clipboard={documentClipboardToolbar({
          editable: true,
          selectionActive,
          onCopy: () => void copyToClipboard(),
          onCut: () => void cutToClipboard(),
          onPaste: () => void pasteFromClipboard(),
        })}
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
      {/* A document selection is custom rather than the textarea's own, so its
          state and any refusal is announced rather than only painted. No
          role="status" so the transient banner stays the only status region. */}
      <p className="sr-only" aria-live="polite" data-selection-status>
        {selectionNotice ?? selectionAnnouncement(selectionSegments.size)}
      </p>
    </WorkspaceRibbon>
  )

  return (
    <WorkspaceShell
      layout={layout}
      onKeyDown={(event) =>
        handleDocumentWorkspaceKeys(event, {
          save: save.save,
          undo: undoDocument,
          redo: redoDocument,
          print: printDocument,
          focusFind: () => document.getElementById('document-find')?.focus(),
          toggleBold:
            format && !format.emphasisUnavailable
              ? format.onToggleBold
              : undefined,
          toggleItalic:
            format && !format.emphasisUnavailable
              ? format.onToggleItalic
              : undefined,
          toggleUnderline:
            format && !format.emphasisUnavailable
              ? format.onToggleUnderline
              : undefined,
        })
      }
    >
      {modelQuery.isLoading ? (
        <LoadingBlock label="Loading document model" />
      ) : modelQuery.isError && !model ? (
        <QueryError
          error={modelQuery.error}
          fallback="The document model could not be loaded."
        />
      ) : model ? (
        <>
          <DocumentPrintStyle box={pages[0]?.box} />
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
                      model={painted ?? model}
                      pageNumber={index + 1}
                      pageBlocks={laid.blocks}
                      pageFloats={laid.floats}
                      pageTextBoxes={laid.textBoxes}
                      pageLayout={laid}
                      selectedParagraphId={selectedParagraphId}
                      onSelectParagraph={selectParagraph}
                      onTextSelection={(paragraphId, from, to, direction) => {
                        setFormatRange({ from, to })
                        mirrorSelection(paragraphId, from, to, direction)
                      }}
                      selectionSegments={selectionSegments}
                      selectionHandlers={selectionHandlers}
                      onFocusParagraph={focusParagraph}
                      onMoveCaret={moveCaret}
                      drafts={drafts.drafts}
                      emphasis={drafts.format.emphasis}
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
                      extraRuns={drafts.extraRuns}
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
                        const { selectId } = drafts.deleteParagraph(paragraphId)
                        if (selectId) selectParagraph(selectId)
                      }}
                      onWordEdit={(edit) => {
                        const outcome = drafts.handleWordEdit(model, edit)
                        if (outcome?.status === 'applied') {
                          selectParagraph(
                            outcome.caret.paragraphId,
                            outcome.caret.offset,
                          )
                        } else if (outcome?.status === 'refused') {
                          reportJoinRefusal(outcome.refusal)
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
                  decideChange.mutate(
                    { baseVersionId, action, changeIds: [changeId] },
                    {
                      onSuccess: (data) =>
                        drafts.resetHistoryAfterDecision(
                          data.versionId,
                          data.versionNumber,
                        ),
                    },
                  )
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
