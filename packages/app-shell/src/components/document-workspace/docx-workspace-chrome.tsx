import { useLayoutEffect, useState } from 'react'
import type { CitationStyle } from '../../document-preferences'
import type {
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
} from './ribbon-types'
import type { EditorChromeProps } from './editor-commands'
import type { InsertRibbonProps } from './use-insert-ribbon'
import type { DocumentSave } from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import type { useWorkspacePanels } from './use-workspace-panels'
import type { ChangeReview } from './use-change-review'
import type { documentExportHandlers } from './document-workspace-export'
import { documentClipboardToolbar } from './use-workspace-clipboard'
import { changeReviewToolbar } from './change-review-toolbar'
import { editorMenus } from './editor-commands'
import { EditorMenuBar } from './editor-menu-bar'
import { EditorToolbar } from './editor-toolbar'
import { EditorFindBar } from './editor-find-bar'
import { EditorCommandPalette } from './editor-command-palette'
import { EditorFormattingPanel } from './editor-formatting-panel'
import { EditorSelectionToolbar } from './editor-selection-toolbar'
import { InsertTableDialog } from './insert-table-dialog'
import { InsertLinkDialog } from './insert-link-dialog'
import { InsertCrossReferenceDialog } from './insert-cross-reference-dialog'
import { InsertAuthorityDialog } from './insert-authority-dialog'
import { PendingCitationBar } from './pending-citation-bar'
import { usePendingCitation } from './use-pending-citation'
import { WorkspaceBanners } from './workspace-banners'
import { WorkspaceRibbon } from './workspace-chrome'
import { useVerificationWorkspace } from '../verification/verification-context'

type DocumentExportHandlers = ReturnType<typeof documentExportHandlers>
type WorkspacePanels = ReturnType<typeof useWorkspacePanels>

export function DocxWorkspaceChrome({
  props,
  save,
  drafts,
  remoteChange,
  transientNotice,
  selectionNotice,
  onReload,
  requests,
  selectionActive,
  onCommentSelection,
  citation,
  citationCanInsert,
}: {
  props: EditorChromeProps
  save: DocumentSave
  drafts: WorkspaceDrafts
  remoteChange: boolean
  transientNotice: string | null
  selectionNotice: string
  onReload: () => void
  requests: { find: number; palette: number; formatting: number }
  selectionActive: boolean
  onCommentSelection: () => void
  citation: ReturnType<typeof usePendingCitation>
  citationCanInsert: boolean
}) {
  const [formattingOpen, setFormattingOpen] = useState(false)
  const [formattingAnchor, setFormattingAnchor] = useState<HTMLElement | null>(
    null,
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [crossReferenceOpen, setCrossReferenceOpen] = useState(false)
  const [authorityOpen, setAuthorityOpen] = useState(false)
  const openFormatting = (anchor: HTMLElement | null) => {
    setFormattingAnchor(anchor)
    setFormattingOpen((open) => !open)
  }
  useLayoutEffect(() => {
    if (requests.formatting === 0) return
    setFormattingAnchor(
      document.querySelector<HTMLElement>('[data-editor-toolbar]'),
    )
    setFormattingOpen(true)
  }, [requests.formatting])
  useLayoutEffect(() => {
    if (requests.find > 0) setFindOpen(true)
  }, [requests.find])
  useLayoutEffect(() => {
    if (requests.palette > 0) setPaletteOpen(true)
  }, [requests.palette])
  useLayoutEffect(() => {
    if (findOpen) document.getElementById('document-find')?.focus()
  }, [findOpen])

  const verification = useVerificationWorkspace()
  const verify = verification
    ? {
        available: verification.startAvailability.available,
        reason:
          'reason' in verification.startAvailability
            ? verification.startAvailability.reason
            : '',
        pending: verification.startPending,
      }
    : props.verify
  const actions = {
    openFormatting: () => openFormatting(formattingAnchor),
    openFind: () => setFindOpen(true),
    openPalette: () => setPaletteOpen(true),
    openTable: () => setTableOpen(true),
    openLink: () => setLinkOpen(true),
    openCrossReference: () => setCrossReferenceOpen(true),
    openAuthority: () => setAuthorityOpen(true),
    closeStory: props.structure.onCloseStory,
  }
  const menued: EditorChromeProps = {
    ...props,
    verify,
    onOpenVerify: verification
      ? () => {
          props.onOpenVerify?.()
          verification.revealStart()
        }
      : props.onOpenVerify,
  }
  const menus = editorMenus(menued, actions)
  return (
    <WorkspaceRibbon>
      <div className="flex items-stretch border-b border-line px-3">
        <EditorMenuBar menus={menus} />
      </div>
      <EditorToolbar
        props={props}
        onOpenFormatting={() =>
          openFormatting(
            document.querySelector<HTMLElement>('[data-editor-toolbar]'),
          )
        }
        onOpenPalette={() => setPaletteOpen(true)}
      />
      {citation.text === null ? null : (
        <PendingCitationBar
          citation={citation.text}
          canInsert={citationCanInsert}
          onInsert={citation.insertCitation}
          onCancel={citation.cancelCitation}
        />
      )}
      {findOpen && props.find ? (
        <EditorFindBar find={props.find} onClose={() => setFindOpen(false)} />
      ) : null}
      <WorkspaceBanners
        save={save}
        drafts={drafts}
        remoteChange={remoteChange}
        transientNotice={transientNotice}
        selectionNotice={selectionNotice}
        onReload={onReload}
      />
      <EditorFormattingPanel
        open={formattingOpen}
        onOpenChange={setFormattingOpen}
        anchor={formattingAnchor}
        format={props.format}
        markings={props.markings}
      />
      <EditorCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        menus={menus}
      />
      <EditorSelectionToolbar
        visible={selectionActive && props.canEdit}
        format={props.format}
        canComment
        onComment={onCommentSelection}
        onCite={actions.openAuthority}
      />

      {props.structure.picturePicker}
      <InsertTableDialog
        open={tableOpen}
        onOpenChange={setTableOpen}
        onInsert={(rows, columns) =>
          props.structure.onInsertTable(rows, columns)
        }
      />
      <InsertLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onInsert={(target) =>
          props.structure.onInsertLink(target) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
      <InsertCrossReferenceDialog
        open={crossReferenceOpen}
        onOpenChange={setCrossReferenceOpen}
        targets={props.structure.crossReferenceTargets}
        onInsert={(targetParagraphId) =>
          props.structure.onInsertCrossReference(targetParagraphId) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
      <InsertAuthorityDialog
        open={authorityOpen}
        onOpenChange={setAuthorityOpen}
        disabled={!props.canInsertAuthority}
        citationStyle={props.citationStyle}
        onInsert={props.onInsertAuthorityText}
      />
    </WorkspaceRibbon>
  )
}

export type DocxChromeProps = EditorChromeProps

export function docxWorkspaceChrome({
  save,
  drafts,
  trackChanges,
  zoom,
  panels,
  commentCount,
  changeCount,
  insert,
  onInsertAuthorityText,
  canInsertAuthority,
  citationStyle,
  onCitationStyle,
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
  onCopy,
  onCut,
  onPaste,
  find,
  changeReview,
  markings,
  view,
  onView,
  rulerOn,
  onToggleRuler,
  navOpen,
  onToggleNavPane,
  spelling,
  onToggleSpelling,
  onOpenVerify,
  infoOpen,
  onToggleInfo,
  onOpenCompare,
}: {
  save: DocumentSave
  drafts: WorkspaceDrafts
  trackChanges: boolean
  zoom: number
  panels: WorkspacePanels
  commentCount: number
  changeCount: number
  insert: InsertRibbonProps
  onInsertAuthorityText: (citation: string) => void
  canInsertAuthority: boolean
  citationStyle: CitationStyle
  onCitationStyle?: (style: CitationStyle) => void
  setZoom: (next: number) => void
  exports: DocumentExportHandlers
  print: () => void
  undo: () => void
  redo: () => void
  selectedParagraphId: string | null
  selectParagraph: (paragraphId: string, offset?: number) => void
  deleteParagraphReason?: string
  format?: DocumentFormatToolbar
  selectionActive: boolean
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  find?: DocumentFindToolbar
  changeReview: ChangeReview
  markings?: DocumentMarkingsToolbar
  view: 'print' | 'web'
  onView: (view: 'print' | 'web') => void
  rulerOn: boolean
  onToggleRuler: () => void
  navOpen: boolean
  onToggleNavPane: () => void
  spelling: boolean
  onToggleSpelling: () => void
  onOpenVerify: () => void
  infoOpen: boolean
  onToggleInfo?: () => void
  onOpenCompare?: () => void
}): DocxChromeProps {
  return {
    trackChanges,
    zoom,
    commentsOpen: panels.active === 'comments',
    changesOpen: panels.active === 'review',
    authoritiesOpen: panels.active === 'authorities',
    infoOpen,
    commentCount,
    changeCount,
    canEdit: true,
    ...insert,
    canUndo: drafts.canUndo,
    canRedo: drafts.canRedo,
    onToggleComments: () => panels.toggle('comments'),
    onToggleChanges: () => panels.toggle('review'),
    onToggleAuthorities: () => panels.toggle('authorities'),
    onToggleInfo,
    onOpenCompare,
    onInsertAuthorityText,
    canInsertAuthority,
    onOpenVerify,
    citationStyle,
    onCitationStyle,
    legalChecks: {
      open: panels.legalChecksFocus,
      onOpen: panels.openLegalChecks,
    },
    onToggleTrackChanges: () => drafts.setTrackChangesFlip(!trackChanges),
    onZoom: setZoom,
    onExportText: exports.onExportText,
    onExportShareSafe: exports.onExportShareSafe,
    onPrint: print,
    onUndo: undo,
    onRedo: redo,
    onInsertParagraph: () => {
      if (!selectedParagraphId) return
      selectParagraph(drafts.insertAfter(selectedParagraphId), 0)
    },
    onDeleteParagraph: () => {
      if (!selectedParagraphId) return
      const { selectId } = drafts.deleteParagraph(selectedParagraphId)
      if (selectId) selectParagraph(selectId)
    },
    deleteParagraphReason,
    onSave: save.save,
    canSave: save.dirty && !save.saving && save.saveState.status !== 'blocked',
    saveReason: save.saving
      ? 'The save is still running.'
      : save.saveState.status === 'blocked'
        ? 'The edit history needs a reload before saving.'
        : 'There are no unsaved changes.',
    format,
    clipboard: documentClipboardToolbar({
      editable: true,
      selectionActive,
      onCopy,
      onCut,
      onPaste,
    }),
    find,
    review: changeReviewToolbar(changeReview),
    markings,
    view,
    onView,
    rulerOn,
    onToggleRuler,
    navOpen,
    onToggleNavPane,
    spelling,
    onToggleSpelling,
  }
}
