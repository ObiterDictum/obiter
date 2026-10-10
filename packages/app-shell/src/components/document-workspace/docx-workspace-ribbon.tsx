import type { DocumentPresence } from '@obiter/contracts'
import type { CitationStyle } from '../../document-preferences'
import type {
  DocumentClipboardToolbar,
  DocumentFindToolbar,
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
  DocumentReviewToolbar,
} from './ribbon-types'
import type { LegalChecksFocus } from './ribbon-review'
import type { InsertRibbonProps } from './use-insert-ribbon'
import type { DocumentSave } from './use-document-save'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import { DocumentWorkspaceToolbar } from './toolbar'
import { WorkspaceBanners } from './workspace-banners'
import { WorkspaceRibbon } from './workspace-chrome'

/**
 * The DOCX workspace's ribbon strip: the tabbed toolbar plus the save and
 * recovery banners that sit beneath it. Lifted out of the workspace
 * component, which had grown to its source ceiling, so the desk layout —
 * pages, ruler, navigation pane, side panels — is what stays in
 * `docx-workspace.tsx`.
 */
export function DocxWorkspaceRibbon({
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
      <DocumentWorkspaceToolbar
        dirty={save.dirty}
        saving={save.saving}
        blocked={save.saveState.status === 'blocked'}
        {...toolbar}
      />
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
export type DocxRibbonToolbarProps = InsertRibbonProps & {
  canEdit: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  authoritiesOpen: boolean
  commentCount: number
  changeCount: number
  presence: DocumentPresence[]
  currentUserId?: string
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
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onExportShareSafe: () => void
  onPrint: () => void
  onSave: () => void
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
}
