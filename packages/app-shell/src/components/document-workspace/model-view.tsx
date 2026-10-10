import { useMemo } from 'react'
import type {
  DocumentModelWire,
  DocumentPresence,
  DocumentStoryWire,
} from '@obiter/contracts'
import { storyFlowParagraphIds, type LocalInsert } from '../../document-edits'
import {
  emptyFormatDrafts,
  type PendingEmphasis,
} from '../../document-format-types'
import type { ExtraRuns } from '../../document-word-edits'
import {
  documentPageBox,
  marginStories,
  contentFrame,
  type ColumnFrame,
  type ContentFrame,
  type PageBox,
} from '../../document-page-layout'
import { marginBandHeights } from '../../document-page-margin'
import { storyBlocks } from '../../document-page-tables'
import type { LaidOutBlock } from '../../document-page-engine'
import type { PageFloat, PageTextBox } from '../../document-page-floats'
import type { ParagraphLinkOverlay } from '../../document-structure-overlays'
import { documentListMarkers } from '../../document-page-lists'
import { paragraphStoryResolver } from '../../document-model-text'
import { documentNotes } from '../../document-page-notes'
import { pageClickHandlers } from './model-page-clicks'
import type { ParagraphWordEdit } from './model-paragraph'
import type { ParagraphSelectionRange } from './model-run'
import { PageOverlays, renderBlock } from './model-page-blocks'
import {
  paragraphNeighborResolver,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import { PageMarginBand, type EditableMargin } from './page-margin-band'
import { useMarginEdit } from './use-margin-edit'

/**
 * The omitted-prop defaults for the structural draft inputs. A `[]` in the
 * signature would mint a fresh array on every render and re-derive this page's
 * whole derived set for a caller that omits the prop, with no warning: the
 * `derived` memo below is keyed on those identities, so they have to survive a
 * render that changes nothing structural. Nothing in this module mutates them.
 */
const NO_INSERTS: LocalInsert[] = []
const NO_DELETED_PARAGRAPH_IDS: string[] = []
const NO_EXTRA_RUNS: ExtraRuns = {}

export function DocumentModelPage({
  model,
  selectedParagraphId,
  onSelectParagraph,
  onTextSelection,
  drafts,
  emphasis = emptyFormatDrafts.emphasis,
  onRunTextChange,
  editing,
  presence,
  currentUserId,
  inserts = NO_INSERTS,
  deletedParagraphIds = NO_DELETED_PARAGRAPH_IDS,
  extraRuns = NO_EXTRA_RUNS,
  onInsertTextChange,
  onInsertParagraph,
  onDeleteParagraph,
  onJoinPrevious,
  onWordEdit,
  restoreCaret,
  verticalCaret,
  imageUrls = {},
  pageBlocks,
  pageFloats = [],
  pageTextBoxes = [],
  pageLayout,
  pageNumber = 1,
  pageReferences,
  selectionSegments = new Map(),
  linkOverlays,
  selectionHandlers,
  onFocusParagraph,
  onMoveCaret,
  marginEditing,
  onExitMarginEditing,
  onOpenNoteEditing,
  /** The continuous web view: no margin bands, and the root measures the
   * flow's content rather than a paper box. The workspace closes any open
   * margin story before switching, so `marginEditing` never meets this. */
  chromeless = false,
}: {
  model: DocumentModelWire
  selectedParagraphId: string | null
  onSelectParagraph: (paragraphId: string, offset?: number) => void
  onTextSelection?: (
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) => void
  drafts?: Record<string, string>
  /** Pending range emphasis, in the same offsets as the text drafts. */
  emphasis?: readonly PendingEmphasis[]
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  inserts?: LocalInsert[]
  deletedParagraphIds?: string[]
  /** Text held outside the painted runs, which the layout merges back in. */
  extraRuns?: ExtraRuns
  onInsertTextChange?: (clientId: string, text: string) => void
  onInsertParagraph?: (afterParagraphId: string) => void
  onDeleteParagraph?: (paragraphId: string) => void
  onJoinPrevious?: (paragraphId: string) => boolean | void
  onWordEdit?: (edit: ParagraphWordEdit) => void
  restoreCaret?: { paragraphId: string; offset: number } | null
  verticalCaret?: VerticalCaretColumn
  imageUrls?: Record<string, string>
  pageBlocks?: LaidOutBlock[]
  pageFloats?: PageFloat[]
  pageTextBoxes?: PageTextBox[]
  /** The section's own page geometry, when the paginator knows it. A section
   * whose geometry differs from the body must be framed with its own box, not
   * the body-level one. */
  pageLayout?: {
    box: PageBox
    frame: ContentFrame
    columns: ColumnFrame[]
    /** The web flow's real content height, when the unbounded frame set it. */
    contentPx?: number
  }
  pageNumber?: number
  /** Bookmark name → laid-out page: resolves `PAGEREF` field instructions. */
  pageReferences?: ReadonlyMap<string, number>
  selectionSegments?: ReadonlyMap<string, ParagraphSelectionRange>
  /** Pending hyperlink ranges and cross-reference markers, by paragraph. */
  linkOverlays?: ReadonlyMap<string, ParagraphLinkOverlay>
  selectionHandlers?: ParagraphSelectionHandlers
  onFocusParagraph?: (paragraphId: string) => void
  onMoveCaret?: (paragraphId: string, offset: number) => void
  /** The header/footer story open for editing, resolved on this model. While
   * set the body is inert and the matching margin band renders editable. */
  marginEditing?: DocumentStoryWire
  /** A click on the body while a margin story is open closes the story, the
   * way Word leaves header editing — the click then lands as a body caret. */
  onExitMarginEditing?: () => void
  /** A click on a painted footnote body opens the footnotes story with the
   * caret on that paragraph — the inverse of `onExitMarginEditing`. */
  onOpenNoteEditing?: (paragraphId: string) => void
  /** Drop the margin bands and measure the flow's content, for the web view. */
  chromeless?: boolean
}) {
  const derived = useMemo(() => {
    const story = model.stories.find((item) => item.kind === 'document')
    const headers = marginStories(model, 'header')
    const footers = marginStories(model, 'footer')
    const page = pageLayout?.box ?? documentPageBox(model)
    const bands = marginBandHeights(model)
    const frame = pageLayout?.frame ?? contentFrame(page, bands)
    const listMarkers = documentListMarkers(model)
    const notes = documentNotes(model)
    const noteParagraphIds = new Set(
      notes.flatMap((note) => note.paragraphs.map((paragraph) => paragraph.id)),
    )
    const noteMarks = new Map(
      notes.flatMap((note) => {
        const first = note.paragraphs[0]
        return first
          ? [[first.id, { mark: note.mark, kind: note.kind }] as const]
          : []
      }),
    )
    // A paragraph outside the body renders inside another story's part, so
    // its story has to travel with the element: verification locations are
    // story-scoped, and a paragraph id alone is not unique.
    const storyOf = paragraphStoryResolver(model)
    const order = storyFlowParagraphIds(story, inserts, deletedParagraphIds)
    // One resolver over the story's flow order per model. Building it inside
    // the per-paragraph render walked the whole document for every paragraph
    // and made a render O(n^2) on a long document.
    const neighbors = paragraphNeighborResolver({
      model,
      extraRuns,
      inserts,
      deletedParagraphIds,
      paragraphs: story?.paragraphs ?? [],
      order,
    })
    return {
      story,
      headers,
      footers,
      page,
      frame,
      listMarkers,
      noteParagraphIds,
      noteMarks,
      storyOf,
      order,
      neighbors,
    }
  }, [model, extraRuns, inserts, deletedParagraphIds, pageLayout])
  const {
    story,
    headers,
    footers,
    page,
    frame,
    listMarkers,
    noteParagraphIds,
    noteMarks,
    storyOf,
    order,
    neighbors,
  } = derived

  const marginEdit = useMarginEdit(
    marginEditing,
    model,
    inserts,
    deletedParagraphIds,
    drafts,
    extraRuns,
  )
  // A click only places the caret inside the story open for editing: while a
  // margin story is open the body stays inert, and while it is not the margin
  // paragraphs are read-only paint.
  const editableIds = useMemo(
    () => new Set(marginEdit ? marginEdit.order : order),
    [marginEdit, order],
  )
  if (!story || story.paragraphs.length === 0) {
    return (
      <p className="px-24 py-24 text-[15px] leading-[1.15] text-[#6b6862]">
        This document has no typed body text.
      </p>
    )
  }

  const blocks: LaidOutBlock[] = pageBlocks ?? storyBlocks(story)
  const columns = pageLayout?.columns ?? [{ left: 0, widthPx: frame.widthPx }]
  const firstColumn = columns[0]
  const nextColumn = columns[1]
  const gap =
    firstColumn && nextColumn ? nextColumn.left - firstColumn.widthPx : 0

  // The fields every block context on this page shares — the body column and
  // the editable margin band differ only in the story they bind.
  const sharedCtx = {
    model,
    selectedParagraphId,
    onSelectParagraph,
    onTextSelection,
    drafts,
    emphasis,
    onRunTextChange,
    presence,
    currentUserId,
    inserts,
    deletedParagraphIds,
    onInsertTextChange,
    onInsertParagraph,
    onDeleteParagraph,
    onJoinPrevious,
    onWordEdit,
    restoreCaret,
    verticalCaret,
    imageUrls,
    listMarkers,
    noteMarks,
    noteParagraphIds,
    editableNotePart:
      editing && marginEditing?.kind === 'footnotes'
        ? marginEditing.partName
        : undefined,
    storyOf,
    selectionSegments,
    linkOverlays,
    selectionHandlers,
    onFocusParagraph,
    onMoveCaret,
    pageNumber,
    pageReferences,
  }
  // While a margin story is open the body keeps painting exactly as before
  // but takes no caret, edits, or selection; the band holding the story gets
  // the full block context instead.
  const editableMargin: EditableMargin | undefined =
    marginEdit && marginEditing
      ? {
          partName: marginEdit.partName,
          blocks: marginEdit.blocks,
          ctx: {
            ...sharedCtx,
            storyPartName: marginEditing.partName,
            editing,
            paragraphs: marginEditing.paragraphs,
            columnWidthPx: frame.widthPx,
            neighbors: marginEdit.neighbors,
          },
        }
      : undefined
  const headerEdit =
    editableMargin &&
    headers.some((item) => item.partName === editableMargin.partName)
      ? editableMargin
      : undefined
  const footerEdit =
    editableMargin &&
    footers.some((item) => item.partName === editableMargin.partName)
      ? editableMargin
      : undefined
  const bodyEditing = editing && !editableMargin

  return (
    <div
      className="relative flex flex-col overflow-clip"
      style={{
        height: chromeless
          ? Math.max(pageLayout?.contentPx ?? 0, 240)
          : page.heightPx,
      }}
      data-document-page
      {...pageClickHandlers({
        editing,
        marginEditing,
        story,
        drafts,
        inserts,
        extraRuns,
        editableIds,
        storyOf,
        verticalCaret,
        onOpenNoteEditing,
        onExitMarginEditing,
        onSelectParagraph,
      })}
    >
      {!chromeless && (
        <PageMarginBand
          stories={headers}
          label="Document header"
          edge="top"
          className={
            headerEdit
              ? 'shrink-0'
              : 'pointer-events-none shrink-0 overflow-hidden'
          }
          editable={headerEdit}
          heightPx={frame.top}
          relationships={model.relationships}
          imageUrls={imageUrls}
          styles={model.styles}
          pageNumber={pageNumber}
          padding={{
            left: page.margin.left,
            right: page.margin.right,
            edge: page.headerPx,
          }}
        />
      )}
      <div
        aria-label="Document body"
        className="relative flex min-h-0 overflow-clip"
        style={{
          height: frame.heightPx,
          marginLeft: frame.left,
          width: frame.widthPx,
          gap,
        }}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={`col-${columnIndex}`}
            className="flex min-h-0 flex-col overflow-clip"
            style={{ width: column.widthPx }}
          >
            {blocks
              .filter((block) => (block.column ?? 0) === columnIndex)
              .flatMap((block, index) =>
                renderBlock(block, index, {
                  ...sharedCtx,
                  storyPartName: story.partName,
                  editing: bodyEditing,
                  paragraphs: story.paragraphs,
                  columnWidthPx: column.widthPx,
                  neighbors,
                }),
              )}
          </div>
        ))}
        <PageOverlays
          floats={pageFloats}
          textBoxes={pageTextBoxes}
          frame={frame}
          model={model}
          storyPartName={story.partName}
          paragraphs={story.paragraphs}
          storyOf={storyOf}
          drafts={drafts}
          emphasis={emphasis}
          imageUrls={imageUrls}
          selectionSegments={selectionSegments}
          selectionHandlers={selectionHandlers}
          pageNumber={pageNumber}
        />
      </div>
      {!chromeless && (
        <PageMarginBand
          stories={footers}
          label="Document footer"
          edge="bottom"
          className={
            footerEdit
              ? 'mt-auto flex shrink-0 flex-col justify-end'
              : 'pointer-events-none mt-auto flex shrink-0 flex-col justify-end overflow-hidden'
          }
          editable={footerEdit}
          heightPx={frame.bottom}
          relationships={model.relationships}
          imageUrls={imageUrls}
          styles={model.styles}
          pageNumber={pageNumber}
          padding={{
            left: page.margin.left,
            right: page.margin.right,
            edge: page.footerPx,
          }}
        />
      )}
    </div>
  )
}
