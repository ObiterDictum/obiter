import { useState } from 'react'
import { useCurrentUser } from '../../current-user'
import {
  documentFormatToolbar,
  type FormatTarget,
} from '../../document-format-edits'
import { findMatchLabel } from '../../document-find'
import { documentStory } from '../../document-model-text'
import { documentWorkspaceKeyDown } from '../../document-workspace-keys'
import {
  useDocumentComments,
  useDocumentModel,
  useDocumentTrackedChanges,
  useDocumentCollaborationSync,
  useTrackedChangeDecision,
} from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import { DocxModelPages } from './docx-model-pages'
import { DocumentSaveBanners } from './save-banners'
import { InsertAuthorityDialog } from './insert-authority-dialog'
import { DocumentWorkspaceToolbar } from './toolbar'
import { useChangeReview } from './use-change-review'
import { usePublishDocumentDirty } from './document-draft-status'
import { WorkspaceSidePanels } from './workspace-side-panels'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
import { useDocumentSave } from './use-document-save'
import { useWorkspaceDerivations } from './use-workspace-derivations'
import { useWorkspaceDrafts } from './use-workspace-drafts'
import { useWorkspaceCaret } from './use-workspace-caret'
import { useWorkspaceComments } from './use-workspace-comments'
import { documentClipboardToolbar } from './use-workspace-clipboard'
import { exportDocumentAsDocx } from './document-workspace-export'
import { selectionAnnouncement } from './document-workspace-status'
import { useLegalToolsState } from './use-legal-tools-state'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import { VerificationMarkerLayer } from '../verification/verification-marker-layer'
import { DocumentDesk, DocumentPrintStyle } from './document-page'
import { useDocumentPrint } from './use-document-print'
import {
  ConflictBanner,
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
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
  const legalTools = useLegalToolsState(documentId)
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
    editingKind,
    editingStory,
    openEditingStory,
    closeEditingStory,
    selectionActive,
    selectionDirection,
    selectionSegments,
    selectionNotice,
    selectAll,
    extendSelection,
    commentTarget,
    revealCommentAnchor,
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

  // One review derivation feeds the ribbon's controls and the Changes panel,
  // so both surfaces share the active target, the barriers and the dispatch.
  const changeReview = useChangeReview({
    documentId,
    model,
    changes: changesQuery.data?.changes ?? [],
    baseVersionId,
    decision: decideChange,
    drafts,
    save,
    caret: {
      editingKind,
      selectParagraph,
      openEditingStory,
      closeEditingStory,
      selectedParagraphId,
    },
    onSaved: (version) => setSavedVersion({ documentId, versionId: version }),
    onNotice: setBanner,
  })

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
  const {
    painted,
    pages,
    authorities,
    imageUrls,
    deleteParagraphReason,
    insert,
    linkOverlays,
    legalChecks,
  } = useWorkspaceDerivations({
    documentId,
    model,
    drafts,
    insert: {
      caret: formatTarget,
      offset: formatRange?.to ?? null,
      trackChanges,
      onImageError: setBanner,
      editingStory: editingKind === 'document' ? undefined : editingStory,
      paragraphId: selectedParagraphId,
      margin: {
        editingKind,
        onOpen: openEditingStory,
        onClose: closeEditingStory,
      },
    },
  })
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
  const commentsPanel = useWorkspaceComments({
    documentId,
    listed: commentsQuery.data,
    commentTarget,
    currentUserId: me?.user.id,
    canModerate: me?.user.role === 'owner' || me?.user.role === 'admin',
    revealCommentAnchor,
  })
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
  // Undo, redo, print and reload can each disable or unmount the focused
  // control mid-step — an emptied stack disables the button, a cleared banner
  // unmounts it — so the ribbon controls and the keyboard chords share these
  // wrappers: focus is handed to the caret before the step can drop it to
  // document.body and lose the typed burst.
  const undo = () => {
    refocusCaretBeforeFlight()
    undoDocument()
  }
  const redo = () => {
    refocusCaretBeforeFlight()
    redoDocument()
  }
  const print = () => {
    refocusCaretBeforeFlight()
    printDocument()
  }
  const reload = () => {
    refocusCaretBeforeFlight()
    save.reload()
  }
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
        commentCount={commentsPanel.threadCount}
        changeCount={changesQuery.data?.changes.length ?? 0}
        presence={presence}
        currentUserId={me?.user.id}
        canEdit
        {...insert}
        canUndo={drafts.canUndo}
        canRedo={drafts.canRedo}
        onToggleComments={() => setCommentsOpen((value) => !value)}
        onToggleChanges={() => setChangesOpen((value) => !value)}
        onToggleAuthorities={() => setAuthoritiesOpen((value) => !value)}
        onInsertAuthority={() => setInsertAuthorityOpen(true)}
        citationStyle={legalTools.citationStyle}
        onCitationStyle={legalTools.onCitationStyle}
        legalChecks={legalTools.legalChecks}
        onToggleTrackChanges={() => setTrackChanges((value) => !value)}
        onZoom={setZoom}
        onExportText={() => {
          refocusCaretBeforeFlight()
          void exportDocumentAsDocx(documentId, filename).then((message) => {
            if (message) setBanner(message)
          })
        }}
        onPrint={print}
        onSave={save.save}
        onUndo={undo}
        onRedo={redo}
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
        review={{
          unavailable: changeReview.unavailable ?? undefined,
          bulkUnavailable: changeReview.bulkUnavailable,
          targetUnavailable: changeReview.targetUnavailable,
          undecidableCount: changeReview.undecidableCount,
          canPrevious: changeReview.canPrevious,
          canNext: changeReview.canNext,
          onPreviousChange: changeReview.goToPrevious,
          onNextChange: changeReview.goToNext,
          onAcceptChange: () => changeReview.decideCurrent('accept'),
          onRejectChange: () => changeReview.decideCurrent('reject'),
          onAcceptAll: () => changeReview.decideAll('accept'),
          onRejectAll: () => changeReview.decideAll('reject'),
        }}
      />
      <DocumentSaveBanners save={save} drafts={drafts} />
      {save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="The document has changed since editing began."
            actionLabel="Reload"
            onAction={reload}
          />
        </div>
      ) : null}
      {remoteChange && save.dirty && !save.stale ? (
        <div className="px-3 pb-2">
          <ConflictBanner
            body="A colleague saved a newer version. Reload before saving, or save to merge disjoint edits."
            actionLabel="Reload"
            onAction={reload}
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
        documentWorkspaceKeyDown(event, {
          save: save.save,
          undo,
          redo,
          print,
          format,
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
                <DocxModelPages
                  model={model}
                  painted={painted}
                  pages={pages}
                  zoom={zoom}
                  editingKind={editingKind}
                  selectedParagraphId={selectedParagraphId}
                  restoreCaret={restoreCaret}
                  verticalCaret={verticalCaret}
                  drafts={drafts}
                  presence={presence}
                  currentUserId={me?.user.id}
                  imageUrls={imageUrls}
                  selectionSegments={selectionSegments}
                  linkOverlays={linkOverlays}
                  selectionHandlers={selectionHandlers}
                  selectParagraph={selectParagraph}
                  setFormatRange={setFormatRange}
                  mirrorSelection={mirrorSelection}
                  focusParagraph={focusParagraph}
                  moveCaret={moveCaret}
                  reportJoinRefusal={reportJoinRefusal}
                  onExitMarginEditing={closeEditingStory}
                  onOpenNoteEditing={(paragraphId) =>
                    openEditingStory('footnotes', paragraphId)
                  }
                />
              </div>
              <WorkspaceSidePanels
                commentsOpen={commentsOpen}
                changesOpen={changesOpen}
                authoritiesOpen={authoritiesOpen}
                legalChecksOpen={legalTools.legalChecksOpen}
                legalChecks={legalChecks}
                {...commentsPanel.props}
                changeReview={changeReview}
                authorities={authorities}
                // An authority always names a body paragraph, so selecting
                // one leaves margin editing the way a body click does before
                // the caret lands — otherwise the caret parks on an inert
                // body paragraph the format controls still target.
                onSelectAuthority={(paragraphId) => {
                  closeEditingStory()
                  selectParagraph(paragraphId)
                }}
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
            citationStyle={legalTools.citationStyle}
            onInsert={(citation) =>
              insertAuthority(citation, legalTools.citationStyle === 'house')
            }
          />
        </>
      ) : null}
    </WorkspaceShell>
  )
}
