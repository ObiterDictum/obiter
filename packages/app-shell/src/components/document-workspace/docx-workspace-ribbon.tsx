import type { CitationStyle } from '../../document-preferences'
import type {
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
  LegalChecksFocus,
} from './ribbon-types'

type WorkspacePanels = ReturnType<typeof useWorkspacePanels>
import type { InsertRibbonProps } from './use-insert-ribbon'
import type { DocumentSave } from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import type { useWorkspacePanels } from './use-workspace-panels'
import type { ChangeReview } from './use-change-review'
import type { documentExportHandlers } from './document-workspace-export'

type DocumentExportHandlers = ReturnType<typeof documentExportHandlers>
import { documentClipboardToolbar } from './use-workspace-clipboard'
import { DocumentWorkspaceToolbar } from './toolbar'
import { changeReviewToolbar } from './change-review-toolbar'
import { WorkspaceBanners } from './workspace-banners'
import { WorkspaceRibbon } from './workspace-chrome'

/**
 * The DOCX workspace's ribbon strip: the tabbed toolbar plus the save and
 * recovery banners that sit beneath it. Lifted out of the workspace
 * component, which had grown to its source ceiling, so the desk layout —
 * pages, ruler, navigation pane, side panels — is what stays in
 * `docx-workspace.tsx`.
 */
function DocxWorkspaceRibbon({
  save,
  drafts,
  remoteChange,
  transientNotice,
  selectionNotice,
  onReload,
  toolbar,
}: {
  save: DocumentSave
  drafts: WorkspaceDrafts
  remoteChange: boolean
  transientNotice: string | null
  selectionNotice: string
  onReload: () => void
  toolbar: DocxRibbonToolbarProps
}) {
  return (
    <WorkspaceRibbon>
      <DocumentWorkspaceToolbar {...toolbar} />
      <WorkspaceBanners
        save={save}
        drafts={drafts}
        remoteChange={remoteChange}
        transientNotice={transientNotice}
        selectionNotice={selectionNotice}
        onReload={onReload}
      />
    </WorkspaceRibbon>
  )
}

/**
 * The toolbar's props beyond the save fields the strip derives. The Insert
 * ribbon's fields are included by intersection because `useInsertRibbon`
 * builds them in the toolbar's own shape.
 */
type DocxRibbonToolbarProps = InsertRibbonProps & {
  canEdit: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  commentCount: number
  changeCount: number
  canUndo?: boolean
  canRedo?: boolean
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleAuthorities: () => void
  onInsertAuthority: () => void
  citationStyle: CitationStyle
  onCitationStyle?: (style: CitationStyle) => void
  legalChecks?: {
    open: LegalChecksFocus | null
    onOpen: (focus: LegalChecksFocus) => void
  }
  onOpenVerify?: () => void
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onExportShareSafe: () => void
  onPrint: () => void
  onUndo: () => void
  onRedo: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  deleteParagraphReason?: string
  format?: DocumentFormatToolbar
  clipboard?: DocumentClipboardToolbar
  find?: DocumentFindToolbar
  review?: DocumentReviewToolbar
  markings?: DocumentMarkingsToolbar
  view: 'print' | 'web'
  onView: (view: 'print' | 'web') => void
  rulerOn: boolean
  onToggleRuler: () => void
  navOpen: boolean
  onToggleNavPane: () => void
  spelling: boolean
  onToggleSpelling: () => void
  versionMeta?: { number: number; editedAt: string }
}

/**
 * Build the ribbon strip from the workspace's own state. The workspace keeps
 * the machines (save, drafts, review, panels) and this file keeps the mapping
 * from those machines to the toolbar's props, so `docx-workspace.tsx` stays
 * inside its source ceiling and the ribbon's wiring sits beside the ribbon.
 */
export function docxWorkspaceRibbon({
  save,
  drafts,
  remoteChange,
  transientNotice,
  selectionNotice,
  onReload,
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
  versionMeta,
  onOpenVerify,
}: {
  save: DocumentSave
  drafts: WorkspaceDrafts
  remoteChange: boolean
  transientNotice: string | null
  selectionNotice: string
  onReload: () => void
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
  versionMeta?: { number: number; editedAt: string }
  onOpenVerify: () => void
}) {
  return (
    <DocxWorkspaceRibbon
      save={save}
      drafts={drafts}
      remoteChange={remoteChange}
      transientNotice={transientNotice}
      selectionNotice={selectionNotice}
      onReload={onReload}
      toolbar={{
        trackChanges,
        zoom,
        commentsOpen: panels.active === 'comments',
        changesOpen: panels.active === 'changes',
        authoritiesOpen: panels.active === 'authorities',
        commentCount,
        changeCount,
        canEdit: true,
        ...insert,
        canUndo: drafts.canUndo,
        canRedo: drafts.canRedo,
        onToggleComments: () => panels.toggle('comments'),
        onToggleChanges: () => panels.toggle('changes'),
        onToggleAuthorities: () => panels.toggle('authorities'),
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
        versionMeta,
      }}
    />
  )
}
