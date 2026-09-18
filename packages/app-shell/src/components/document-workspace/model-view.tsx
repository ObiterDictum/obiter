import { useMemo } from 'react'
import type { DocumentModelWire, DocumentPresence } from '@obiter/contracts'
import type { LocalInsert } from '../../document-edits'
import {
  documentPageBox,
  marginStories,
  contentFrame,
} from '../../document-page-layout'
import { marginBandHeights } from '../../document-page-margin'
import { storyBlocks } from '../../document-page-tables'
import type { LaidOutBlock } from '../../document-page-engine'
import type { PageFloat, PageTextBox } from '../../document-page-floats'
import { documentListMarkers } from '../../document-page-lists'
import { documentNotes } from '../../document-page-notes'
import {
  blockEndOffset,
  paragraphClickCaret,
  pageClickCaret,
} from './model-click-caret'
import type { ParagraphWordEdit } from './model-paragraph'
import type { ParagraphSelectionRange } from './model-run'
import { PageOverlays, renderBlock } from './model-page-blocks'
import {
  clearVerticalColumn,
  paragraphNeighborResolver,
  type VerticalCaretColumn,
} from './paragraph-arrow'
import type { ParagraphSelectionHandlers } from './paragraph-editor'
import { PageMarginBand } from './page-margin-band'

export function DocumentModelPage({
  model,
  selectedParagraphId,
  onSelectParagraph,
  onTextSelection,
  drafts,
  onRunTextChange,
  editing,
  presence,
  currentUserId,
  inserts = [],
  deletedParagraphIds = [],
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
  pageColumns,
  pageNumber = 1,
  selectionSegments = new Map(),
  selectionHandlers,
  onFocusParagraph,
  onMoveCaret,
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
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  inserts?: LocalInsert[]
  deletedParagraphIds?: string[]
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
  pageColumns?: Array<{ left: number; widthPx: number }>
  pageNumber?: number
  selectionSegments?: ReadonlyMap<string, ParagraphSelectionRange>
  selectionHandlers?: ParagraphSelectionHandlers
  onFocusParagraph?: (paragraphId: string) => void
  onMoveCaret?: (paragraphId: string, offset: number) => void
}) {
  const derived = useMemo(() => {
    const story = model.stories.find((item) => item.kind === 'document')
    const headers = marginStories(model, 'header')
    const footers = marginStories(model, 'footer')
    const page = documentPageBox(model)
    const bands = marginBandHeights(model)
    const frame = contentFrame(page, bands)
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
    // A footnote or endnote paragraph is rendered inside the same page flow as
    // the body, so its story has to travel with the element: verification
    // locations are story-scoped, and a paragraph id alone is not unique.
    const storyByParagraph = new Map<
      string,
      { kind: string; partName: string }
    >()
    for (const note of notes) {
      const kind = note.kind === 'footnote' ? 'footnotes' : 'endnotes'
      const partName =
        model.stories.find((item) => item.kind === kind)?.partName ??
        story?.partName ??
        ''
      for (const paragraph of note.paragraphs) {
        storyByParagraph.set(paragraph.id, { kind, partName })
      }
    }
    const bodyStory = { kind: 'document', partName: story?.partName ?? '' }
    const storyOf = (paragraphId: string) =>
      storyByParagraph.get(paragraphId) ?? bodyStory
    // One resolver over the story's flow order per model. Building it inside
    // the per-paragraph render walked the whole document for every paragraph
    // and made a render O(n^2) on a long document.
    const neighbors = paragraphNeighborResolver({
      model,
      inserts,
      deletedParagraphIds,
      paragraphs: story?.paragraphs ?? [],
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
      neighbors,
    }
  }, [model, inserts, deletedParagraphIds])
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
    neighbors,
  } = derived
  if (!story || story.paragraphs.length === 0) {
    return (
      <p className="px-24 py-24 text-[15px] leading-[1.15] text-[#6b6862]">
        This document has no typed body text.
      </p>
    )
  }

  const blocks: LaidOutBlock[] = pageBlocks ?? storyBlocks(story)
  const columns = pageColumns ?? [{ left: 0, widthPx: frame.widthPx }]
  const firstColumn = columns[0]
  const nextColumn = columns[1]
  const gap =
    firstColumn && nextColumn ? nextColumn.left - firstColumn.widthPx : 0

  return (
    <div
      className="relative flex flex-col overflow-clip"
      style={{ height: page.heightPx }}
      data-document-page
      onMouseDown={(event) => {
        event.currentTarget.dataset.pointerDown = `${event.clientX},${event.clientY}`
      }}
      onClick={(event) => {
        if (!editing) return
        if (!(event.target instanceof Element)) return
        const down = event.currentTarget.dataset.pointerDown
        delete event.currentTarget.dataset.pointerDown
        if (down && down !== `${event.clientX},${event.clientY}`) return
        const endOffset = (id: string) =>
          blockEndOffset(id, story.paragraphs, drafts, inserts)
        const paragraphEl = event.target.closest('[data-paragraph-id]')
        if (paragraphEl instanceof HTMLElement) {
          const caret = paragraphClickCaret(
            paragraphEl,
            event.clientX,
            event.clientY,
            event.currentTarget,
            endOffset,
          )
          if (caret) {
            clearVerticalColumn(verticalCaret)
            onSelectParagraph(caret.paragraphId, caret.offset)
            return
          }
        }
        const caret = pageClickCaret(
          event.currentTarget,
          event.clientY,
          endOffset,
        )
        if (caret) {
          clearVerticalColumn(verticalCaret)
          onSelectParagraph(caret.paragraphId, caret.offset)
        }
      }}
    >
      <PageMarginBand
        stories={headers}
        label="Document header"
        edge="top"
        className="pointer-events-none shrink-0 overflow-hidden"
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
                  model,
                  storyPartName: story.partName,
                  selectedParagraphId,
                  onSelectParagraph,
                  onTextSelection,
                  drafts,
                  onRunTextChange,
                  editing,
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
                  paragraphs: story.paragraphs,
                  listMarkers,
                  noteMarks,
                  noteParagraphIds,
                  storyOf,
                  columnWidthPx: column.widthPx,
                  selectionSegments,
                  selectionHandlers,
                  neighbors,
                  onFocusParagraph,
                  onMoveCaret,
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
          imageUrls={imageUrls}
          selectionSegments={selectionSegments}
          selectionHandlers={selectionHandlers}
        />
      </div>
      <PageMarginBand
        stories={footers}
        label="Document footer"
        edge="bottom"
        className="pointer-events-none mt-auto flex shrink-0 flex-col justify-end overflow-hidden"
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
    </div>
  )
}
