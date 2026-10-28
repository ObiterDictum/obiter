import { InlineChangeReview, inlineReviewOf } from './inline-change-review'
import { useState } from 'react'
import { useCurrentUser } from '../../current-user'
import type { FormatTarget } from '../../document-format-edits'
import { documentStory } from '../../document-model-text'
import { documentWorkspaceKeyDown } from '../../document-workspace-keys'
import type {
  DocumentVersionRecord,
  MatterDocumentRecord,
} from '../../documents'
import {
  useDocumentComments,
  useDocumentModel,
  useDocumentTrackedChanges,
  useDocumentCollaborationSync,
  useTrackedChangeDecision,
} from '../../document-workspace-api'
import { revealParagraph, withCaretRefocus } from './document-actions'
import { DocxWorkspaceDesk } from './docx-workspace-desk'
import { docxWorkspaceRibbon } from './docx-workspace-ribbon'
import { DocxEditorHeader } from './document-editor-header'
import {
  closesPanelOnEscape,
  useWorkspacePanels,
  type WorkspacePanel,
} from './use-workspace-panels'
import { useWorkspaceSurface, useWorkspaceView } from './use-workspace-view'
import { InsertAuthorityDialog } from './insert-authority-dialog'
import { useChangeReview } from './use-change-review'
import { usePublishDocumentDirty } from './document-draft-status'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
import { useDocumentSave } from './use-document-save'
import { useWorkspaceDerivations } from './use-workspace-derivations'
import { useWorkspaceDrafts } from './use-workspace-drafts'
import { useWorkspaceCaret } from './use-workspace-caret'
import { useWorkspaceComments } from './use-workspace-comments'
import { documentExportHandlers } from './document-workspace-export'
import { selectionAnnouncement } from './document-workspace-status'
import { useDocumentMarkings } from './use-document-markings'
import { useLegalToolsState } from './use-legal-tools-state'
import { paragraphSelectionHandlers } from './paragraph-selection-handlers'
import { DocumentPrintStyle } from './document-page'
import { useDocumentPrint } from './use-document-print'
import {
  LoadingBlock,
  QueryError,
  WorkspaceShell,
  type DocumentWorkspaceLayout,
} from './workspace-chrome'

export function DocxWorkspace({
  documentId,
  versionId,
  matterId,
  filename,
  versionNumber,
  layout = 'page',
  document: documentRecord,
  versions = [],
  headerLinks,
  headerActions,
  onViewVersion,
}: {
  documentId: string
  versionId: string
  matterId: string
  filename: string
  /** The stored version the workspace opened, for the header's save label. */
  versionNumber?: number
  layout?: DocumentWorkspaceLayout
  /** The detail the route already loaded; absent outside the document route. */
  document?: MatterDocumentRecord
  versions?: DocumentVersionRecord[]
  back?: React.ReactNode
  headerLinks?: { back?: React.ReactNode; matter?: React.ReactNode }
  headerActions?: React.ReactNode
  onViewVersion?: (versionId: string) => void
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
  const panels = useWorkspacePanels()
  const [insertAuthorityOpen, setInsertAuthorityOpen] = useState(false)
  const legalTools = useLegalToolsState(documentId)
  // The toggle follows the version's `w:trackRevisions`. An unsaved flip is
  // the user's intent until a version persists it: it lives in the draft
  // bundle, so it survives a remount the way every other unsaved edit does,
  // and a version write — save, merge, decision or markings — carries it. A
  // reload discards it with the drafts it stood beside.
  const trackChanges =
    drafts.trackChangesFlip !== undefined &&
    drafts.trackChangesFlip !== (model?.trackRevisions ?? false)
      ? drafts.trackChangesFlip
      : (model?.trackRevisions ?? false)
  const [banner, setBanner] = useState<string | null>(null)
  const { printBanner, printDocument } = useDocumentPrint()
  const {
    view,
    setView,
    forPrint,
    rulerOn,
    toggleRuler,
    navOpen,
    toggleNavPane,
    spelling,
    columnRef,
    flow,
    toggleSpelling,
  } = useWorkspaceView()

  const presence = syncQuery.data?.participants ?? []
  const remoteChange = syncQuery.data?.changed === true
  const handleSaved = (version: string | null) => {
    setSavedVersion(version ? { documentId, versionId: version } : null)
  }
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
    onSaved: handleSaved,
  })

  // Verification reads the stored version, so it must stay disabled while any
  // work is off-server: editable operations, a blocked or held change, or a
  // recoverable draft. `useDocumentSave` owns that truth as `saveState`; the
  // E45 recovery paths keep it unsaved until the work is actually covered.
  usePublishDocumentDirty(save.saveState.status !== 'saved')

  // The ribbon's quiet meta names the stored version, not the unsaved state.
  const storedVersionId = modelQuery.data?.versionId ?? versionId
  const storedVersion = versions.find(
    (version) => version.id === storedVersionId,
  )
  const versionMeta = storedVersion
    ? {
        number: modelQuery.data?.versionNumber ?? versionNumber ?? 1,
        editedAt: storedVersion.createdAt,
      }
    : undefined
  const caret = useWorkspaceCaret({ documentId, model, drafts })
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
    selectionSegments,
    selectionNotice,
    commentTarget,
    revealCommentAnchor,
    focusParagraph,
    moveCaret,
    reportJoinRefusal,
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    mirrorSelection,
    find,
    selectParagraph,
    insertAuthority,
    undoDocument,
    redoDocument,
  } = caret

  // One review derivation feeds the ribbon's controls and the Changes panel,
  // so both surfaces share the active target, the barriers and the dispatch.
  const changeReview = useChangeReview({
    documentId,
    model,
    changes: changesQuery.data?.changes ?? [],
    baseVersionId,
    trackChanges,
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
  // Markings commit an immutable version like a decision does, so the hook
  // shares the save machine's barriers and advances the base on success.
  const markings = useDocumentMarkings({
    documentId,
    matterId,
    model,
    baseVersionId,
    trackChanges,
    save,
    onSaved: (version) => setSavedVersion({ documentId, versionId: version }),
    onNotice: setBanner,
  })
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
    pendingRedlines,
    pages,
    printBox,
    authorities,
    imageUrls,
    deleteParagraphReason,
    insert,
    linkOverlays,
    legalChecks,
  } = useWorkspaceDerivations({
    saveOperations: save.operations,
    documentId,
    model,
    drafts,
    flow,
    legalChecksOpen: panels.legalChecksFocus !== null,
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
  const surface = useWorkspaceSurface({
    painted,
    pages,
    drafts,
    formatTarget,
    selectedParagraphId,
    trackChanges,
    editingKind,
    selectParagraph,
    closeEditingStory,
    setView,
    revealParagraph,
  })
  const selectionHandlers = paragraphSelectionHandlers(caret)
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
  const { format, outline, ruler, onView, onSelectOutline } = surface
  // These flights can each disable or unmount the focused control mid-step,
  // so the ribbon controls and the keyboard chords share the caret-refocus
  // wrapper — focus lands on the caret's field before the step can drop it.
  const undo = withCaretRefocus(undoDocument)
  const redo = withCaretRefocus(redoDocument)
  // forPrint repaginates to paper sheets first, so printing from web layout
  // produces paginated output rather than the continuous frame.
  const print = withCaretRefocus(() => void forPrint(printDocument))
  const reload = withCaretRefocus(save.reload)
  const exports = documentExportHandlers(documentId, filename, setBanner)
  // A panel and the navigation pane both narrow the canvas: opening either
  // closes the other rather than squeezing the page twice.
  function togglePanel(panel: WorkspacePanel) {
    if (navOpen) toggleNavPane()
    panels.toggle(panel)
  }
  function toggleNavigation() {
    if (!navOpen) panels.dismiss()
    toggleNavPane()
  }
  const ribbon = docxWorkspaceRibbon({
    save,
    drafts,
    remoteChange,
    transientNotice: transientBanner,
    selectionNotice:
      selectionNotice ?? selectionAnnouncement(selectionSegments.size),
    onReload: reload,
    trackChanges,
    zoom,
    panels,
    commentCount: commentsPanel.threadCount,
    changeCount: changesQuery.data?.changes.length ?? 0,
    insert,
    onInsertAuthority: () => setInsertAuthorityOpen(true),
    citationStyle: legalTools.citationStyle,
    onCitationStyle: legalTools.onCitationStyle,
    setZoom,
    exports,
    print,
    undo,
    redo,
    selectedParagraphId,
    selectParagraph,
    deleteParagraphReason,
    format,
    selectionActive,
    onCopy: () => void copyToClipboard(),
    onCut: () => void cutToClipboard(),
    onPaste: () => void pasteFromClipboard(),
    find,
    changeReview,
    markings,
    view,
    onView,
    rulerOn,
    onToggleRuler: toggleRuler,
    navOpen,
    onToggleNavPane: toggleNavigation,
    spelling,
    onToggleSpelling: () => toggleSpelling(setBanner),
    versionMeta,
    onOpenVerify: () => panels.open('verify'),
  })

  return (
    <InlineChangeReview
      value={inlineReviewOf(changeReview, () => togglePanel('changes'))}
    >
      <WorkspaceShell
        layout={layout}
        onKeyDown={(event) => {
          // Escape closes the docked panel and hands focus back to the control
          // that opened it. It never claims the key from a dialog, the
          // document text or a field outside the panel.
          if (
            event.key === 'Escape' &&
            panels.active !== null &&
            closesPanelOnEscape(event.target)
          ) {
            event.preventDefault()
            panels.close()
            return
          }
          documentWorkspaceKeyDown(event, {
            save: save.save,
            undo,
            redo,
            print,
            format,
          })
        }}
      >
        <DocxEditorHeader
          filename={filename}
          versionNumber={modelQuery.data?.versionNumber ?? versionNumber}
          save={save}
          remoteChange={remoteChange}
          presence={presence}
          currentUserId={me?.user.id}
          trackChanges={trackChanges}
          onToggleTrackChanges={() => drafts.setTrackChangesFlip(!trackChanges)}
          versions={versions}
          onOpenVerify={() => panels.toggle('verify')}
          infoOpen={panels.active === 'info'}
          onToggleInfo={documentRecord ? () => togglePanel('info') : undefined}
          back={headerLinks?.back}
          matterLink={headerLinks?.matter}
          actions={headerActions}
        />
        {modelQuery.isLoading ? (
          <LoadingBlock label="Loading document model" />
        ) : modelQuery.isError && !model ? (
          <QueryError
            error={modelQuery.error}
            fallback="The document model could not be loaded."
          />
        ) : model ? (
          <>
            <DocumentPrintStyle box={printBox} />
            {ribbon}
            <DocxWorkspaceDesk
              pages={{
                view,
                model,
                painted,
                pendingRedlines,
                pages,
                zoom,
                editingKind,
                selectedParagraphId,
                restoreCaret,
                verticalCaret,
                drafts,
                presence,
                currentUserId: me?.user.id,
                imageUrls,
                selectionSegments,
                linkOverlays,
                selectionHandlers,
                selectParagraph,
                setFormatRange,
                mirrorSelection,
                focusParagraph,
                moveCaret,
                reportJoinRefusal,
              }}
              zoom={zoom}
              navOpen={navOpen}
              outline={outline}
              activeParagraphId={selectedParagraphId}
              onSelectOutline={onSelectOutline}
              onCloseNav={toggleNavigation}
              columnRef={columnRef}
              spelling={spelling}
              rulerOn={rulerOn}
              ruler={ruler}
              onExitMarginEditing={closeEditingStory}
              onOpenNoteEditing={(paragraphId) =>
                openEditingStory('footnotes', paragraphId)
              }
              panel={panels.active}
              onClosePanel={panels.close}
              legalChecksFocus={panels.legalChecksFocus}
              documentRecord={documentRecord}
              versions={versions}
              matterLink={headerLinks?.matter}
              onViewVersion={onViewVersion}
              comments={commentsPanel.props}
              changeReview={changeReview}
              authorities={authorities}
              legalChecks={legalChecks}
              // An authority always names a body paragraph, so selecting one
              // leaves margin editing the way a body click does before the
              // caret lands — otherwise the caret parks on an inert body
              // paragraph the format controls still target.
              onSelectAuthority={(paragraphId) => {
                closeEditingStory()
                selectParagraph(paragraphId)
              }}
            />
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
    </InlineChangeReview>
  )
}
