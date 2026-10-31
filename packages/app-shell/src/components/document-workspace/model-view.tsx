import type { PendingRedlines } from '../../document-pending-redlines'
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
import { useLatestCallback } from './use-latest-callback'
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

const NO_INSERTS: LocalInsert[] = []
const NO_DELETED_PARAGRAPH_IDS: string[] = []
const NO_EXTRA_RUNS: ExtraRuns = {}

export function DocumentModelPage({
  model,
  pendingRedlines,
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
  chromeless = false,
}: {
  model: DocumentModelWire
  pendingRedlines?: PendingRedlines
  selectedParagraphId: string | null
  onSelectParagraph: (paragraphId: string, offset?: number) => void
  onTextSelection?: (
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) => void
  drafts?: Record<string, string>
  emphasis?: readonly PendingEmphasis[]
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  inserts?: LocalInsert[]
  deletedParagraphIds?: string[]
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
  pageLayout?: {
    box: PageBox
    frame: ContentFrame
    columns: ColumnFrame[]
    contentPx?: number
  }
  pageNumber?: number
  pageReferences?: ReadonlyMap<string, number>
  selectionSegments?: ReadonlyMap<string, ParagraphSelectionRange>
  linkOverlays?: ReadonlyMap<string, ParagraphLinkOverlay>
  selectionHandlers?: ParagraphSelectionHandlers
  onFocusParagraph?: (paragraphId: string) => void
  onMoveCaret?: (paragraphId: string, offset: number) => void
  marginEditing?: DocumentStoryWire
  onExitMarginEditing?: () => void
  onOpenNoteEditing?: (paragraphId: string) => void
  chromeless?: boolean
}) {
  const derived = useMemo(() => {
    const story = model.stories.find((item) => item.kind === 'document')
    const headers = marginStories(model, 'header')
    const footers = marginStories(model, 'footer')
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
    const storyOf = paragraphStoryResolver(model)
    return {
      story,
      headers,
      footers,
      listMarkers,
      noteParagraphIds,
      noteMarks,
      storyOf,
    }
  }, [model])
  const {
    story,
    headers,
    footers,
    listMarkers,
    noteParagraphIds,
    noteMarks,
    storyOf,
  } = derived

  const { order, neighbors } = useMemo(() => {
    const order = storyFlowParagraphIds(story, inserts, deletedParagraphIds)
    const neighbors = paragraphNeighborResolver({
      model,
      extraRuns,
      inserts,
      deletedParagraphIds,
      paragraphs: story?.paragraphs ?? [],
      order,
    })
    return { order, neighbors }
  }, [model, story, extraRuns, inserts, deletedParagraphIds])
  const latestNeighbors = useLatestCallback(neighbors)

  const page = pageLayout?.box ?? documentPageBox(model)
  const frame =
    pageLayout?.frame ?? contentFrame(page, marginBandHeights(model))

  const marginEdit = useMarginEdit(
    marginEditing,
    model,
    inserts,
    deletedParagraphIds,
    drafts,
    extraRuns,
  )
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

  const sharedCtx = {
    model,
    pendingRedlines,
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
          changes={model.changes}
          drafts={drafts}
          extraRuns={extraRuns}
          pendingRedlines={pendingRedlines}
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
                  neighbors: latestNeighbors,
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
          changes={model.changes}
          drafts={drafts}
          extraRuns={extraRuns}
          pendingRedlines={pendingRedlines}
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
