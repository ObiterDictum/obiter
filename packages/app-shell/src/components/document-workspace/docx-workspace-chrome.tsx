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
import { WorkspaceBanners } from './workspace-banners'
import { WorkspaceRibbon } from './workspace-chrome'

type DocumentExportHandlers = ReturnType<typeof documentExportHandlers>
type WorkspacePanels = ReturnType<typeof useWorkspacePanels>

/**
 * The DOCX workspace's chrome: the menu bar, the compact toolbar and the save
 * and recovery banners beneath them, plus the surfaces a menu row opens — the
 * formatting panel, find, the command palette and the insert dialogs. The desk
 * layout (pages, ruler, navigation pane, side panels) stays in
 * `docx-workspace.tsx`.
 */
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
}: {
  props: EditorChromeProps
  save: DocumentSave
  drafts: WorkspaceDrafts
  remoteChange: boolean
  transientNotice: string | null
  selectionNotice: string
  onReload: () => void
  /** Surface requests from the key handler, counted so a repeat still opens. */
  requests: { find: number; palette: number; formatting: number }
  selectionActive: boolean
  onCommentSelection: () => void
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
  const openFormatting = (anchor: HTMLElement | null) => {
    setFormattingAnchor(anchor)
    setFormattingOpen(true)
  }
  // A command from the key handler or the palette has no toolbar button to
  // anchor to; the panel then opens under the toolbar's own control.
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
  // The find field is not mounted until the bar is, so focus follows the open.
  useLayoutEffect(() => {
    if (findOpen) document.getElementById('document-find')?.focus()
  }, [findOpen])

  const actions = {
    openFormatting: () => openFormatting(formattingAnchor),
    openFind: () => setFindOpen(true),
    openPalette: () => setPaletteOpen(true),
    openTable: () => setTableOpen(true),
    openLink: () => setLinkOpen(true),
    openCrossReference: () => setCrossReferenceOpen(true),
    closeStory: props.structure.onCloseStory,
  }
  const menus = editorMenus(props, actions)
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
        onCite={props.onInsertAuthority}
      />
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
    </WorkspaceRibbon>
  )
}

/**
 * The toolbar's props beyond the save fields the chrome derives. The Insert
 * group's structural fields arrive by intersection because `useInsertRibbon`
 * builds them in the toolbar's own shape.
 */
export type DocxChromeProps = EditorChromeProps

/**
 * Build the chrome's props from the workspace's own state. The workspace keeps
 * the machines (save, drafts, review, panels) and this file keeps the mapping
 * from those machines to the chrome's props, so `docx-workspace.tsx` stays
 * inside its source ceiling.
 */
export function docxWorkspaceChrome({
  save,
  drafts,
  trackChanges,
  zoom,
  panels,
  commentCount,
  changeCount,
  insert,
  onInsertAuthority,
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
  onInsertAuthority: () => void
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
    onInsertAuthority,
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
