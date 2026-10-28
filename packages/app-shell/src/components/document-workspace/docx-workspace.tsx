import { InlineChangeReview, inlineReviewOf } from './inline-change-review'
import { useState } from 'react'
import { useCurrentUser } from '../../current-user'
import type { FormatTarget } from '../../document-format-edits'
import { documentStory } from '../../document-model-text'
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
import {
  DocxWorkspaceChrome,
  docxWorkspaceChrome,
} from './docx-workspace-chrome'
import { DocxEditorHeader } from './document-editor-header'
import {
  useWorkspacePanels,
  workspaceKeyDown,
  type WorkspacePanel,
} from './use-workspace-panels'
import {
  pageZoomFor,
  useWorkspaceSurface,
  useWorkspaceView,
} from './use-workspace-view'
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
  const [savedVersion, setSavedVersion] = useState<{
    documentId: string
    versionId: string
  } | null>(null)
  const baseVersionId =
    savedVersion?.documentId === documentId
      ? savedVersion.versionId
      : (modelQuery.data?.versionId ?? versionId)
  const commentsQuery = useDocumentComments(documentId)
  const changesQuery = useDocumentTrackedChanges(documentId)
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
  // An unsaved flip lives in the draft bundle: a remount keeps it, a version
  // write (save, decision or markings) carries it, a reload drops it.
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
    columnWidth,
    compareOpen,
    setCompareOpen,
    requests,
    request,
    forPrint,
    rulerOn,
    toggleRuler,
    navOpen,
    toggleNavPane,
    spelling,
    columnRef,
    flow,
    toggleSpelling,
  } = useWorkspaceView(Boolean(model))

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

  // Verification reads the stored version, so unsaved work keeps it disabled.
  usePublishDocumentDirty(save.saveState.status !== 'saved')

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

  // One review derivation feeds the chrome and the panel: one active target.
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
  // Markings commit an immutable version, so they share the save barriers.
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
  // The toolbar acts on the selection's ranges, else the caret's paragraph.
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
  const transientBanner = printBanner ?? save.notice ?? banner
  const { format, outline, ruler, onView, onSelectOutline } = surface
  const pageZoom = pageZoomFor(zoom, columnWidth, printBox?.widthPx ?? 794)
  // Each of these can disable or unmount the focused control mid-step, so they
  // share the caret-refocus wrapper: focus lands on the caret's field first.
  const undo = withCaretRefocus(undoDocument)
  const redo = withCaretRefocus(redoDocument)
  // forPrint repaginates first, so printing from web layout uses paper sheets.
  const print = withCaretRefocus(() => void forPrint(printDocument))
  const reload = withCaretRefocus(save.reload)
  const exports = documentExportHandlers(documentId, filename, setBanner)
  // Either narrows the canvas, so opening one closes the other.
  function togglePanel(panel: WorkspacePanel) {
    if (navOpen) toggleNavPane()
    panels.toggle(panel)
  }
  function toggleNavigation() {
    if (!navOpen) panels.dismiss()
    toggleNavPane()
  }
  const chrome = docxWorkspaceChrome({
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
    onOpenVerify: () => panels.open('verify'),
    infoOpen: panels.active === 'info',
    onToggleInfo: documentRecord ? () => togglePanel('info') : undefined,
    onOpenCompare:
      versions.filter(
        (item) => item.documentStatus === 'ready' && item.fileType === 'docx',
      ).length >= 2
        ? () => setCompareOpen(true)
        : undefined,
  })

  return (
    <InlineChangeReview
      value={inlineReviewOf(changeReview, () => togglePanel('review'))}
    >
      <WorkspaceShell layout={layout}
        onKeyDown={(event) =>
          workspaceKeyDown(event, {
            panels,
            save: save.save,
            undo,
            redo,
            print,
            format,
            request,
            review: changeReview,
          })
        }
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
            <DocxWorkspaceChrome
              props={chrome}
              save={save}
              drafts={drafts}
              remoteChange={remoteChange}
              transientNotice={transientBanner}
              selectionNotice={
                selectionNotice ?? selectionAnnouncement(selectionSegments.size)
              }
              onReload={reload}
              requests={requests}
              selectionActive={selectionActive}
              onCommentSelection={() => togglePanel('comments')}
            />
            <DocxWorkspaceDesk
              compareOpen={compareOpen}
              onCloseCompare={() => setCompareOpen(false)}
              documentId={documentId}
              zoom={pageZoom}
              pages={{
                zoom: pageZoom,
                view,
                model,
                painted,
                pendingRedlines,
                pages,
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
              popout={panels.popout}
              legalChecksFocus={panels.legalChecksFocus}
              documentRecord={documentRecord}
              versions={versions}
              matterLink={headerLinks?.matter}
              onViewVersion={onViewVersion}
              comments={commentsPanel.props}
              changeReview={changeReview}
              currentVersionNumber={
                modelQuery.data?.versionNumber ?? versionNumber
              }
              authorities={authorities}
              legalChecks={legalChecks}
              // Leave margin editing first, or the caret parks in the body.
              onSelectAuthority={(paragraphId) => {
                closeEditingStory()
                selectParagraph(paragraphId)
              }}
            />
            <InsertAuthorityDialog
              open={insertAuthorityOpen}
              onOpenChange={setInsertAuthorityOpen}
              disabled={!selectedParagraphId && !documentStory(model)?.paragraphs[0]}
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
