import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentPresence,
} from '@obiter/contracts'
import { insertPlainText, type LocalInsert } from '../../document-edits'
import { paragraphPlainText } from '../../document-model-text'
import {
  contrastFillText,
  imagePartNameForDrawing,
} from '../../document-page-media'
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
import { documentNotes, type NoteKind } from '../../document-page-notes'
import { ModelParagraph } from './model-paragraph'
import type { ParagraphWordEdit } from './model-paragraph'
import { PendingInsert } from './pending-insert'
import { PageDrawing } from './page-drawing'
import { PageMarginBand } from './page-margin-band'
import { PageTable } from './page-table'

export function DocumentModelPage({
  model,
  selectedParagraphId,
  onSelectParagraph,
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
  imageUrls = {},
  pageBlocks,
  pageFloats = [],
  pageTextBoxes = [],
  pageColumns,
  pageNumber = 1,
}: {
  model: DocumentModelWire
  selectedParagraphId: string | null
  onSelectParagraph: (paragraphId: string, offset?: number) => void
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
  imageUrls?: Record<string, string>
  pageBlocks?: LaidOutBlock[]
  pageFloats?: PageFloat[]
  pageTextBoxes?: PageTextBox[]
  pageColumns?: Array<{ left: number; widthPx: number }>
  pageNumber?: number
}) {
  const story = model.stories.find((item) => item.kind === 'document')
  const headers = marginStories(model, 'header')
  const footers = marginStories(model, 'footer')
  const page = documentPageBox(model)
  if (!story || story.paragraphs.length === 0) {
    return (
      <p className="px-24 py-24 text-[15px] leading-[1.15] text-[#6b6862]">
        This document has no typed body text.
      </p>
    )
  }

  const blocks: LaidOutBlock[] = pageBlocks ?? storyBlocks(story)
  const bands = marginBandHeights(model)
  const frame = contentFrame(page, bands)
  const columns = pageColumns ?? [{ left: 0, widthPx: frame.widthPx }]
  const firstColumn = columns[0]
  const nextColumn = columns[1]
  const gap =
    firstColumn && nextColumn ? nextColumn.left - firstColumn.widthPx : 0
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

  return (
    <div
      className="relative flex flex-col overflow-clip"
      style={{ height: page.heightPx }}
      data-document-page
      onClick={(event) => {
        if (!editing) return
        if (!(event.target instanceof Element)) return
        if (event.target.closest('[data-paragraph-id]')) return
        const caret = pageClickCaret(event.currentTarget, event.clientY, (id) =>
          blockEndOffset(id, story.paragraphs, drafts, inserts),
        )
        if (caret) onSelectParagraph(caret.paragraphId, caret.offset)
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
                  imageUrls,
                  paragraphs: story.paragraphs,
                  listMarkers,
                  noteMarks,
                  noteParagraphIds,
                }),
              )}
          </div>
        ))}
        {pageFloats.map((item, index) => {
          const partName = imagePartNameForDrawing(
            item.xml,
            story.partName,
            model.relationships,
          )
          return (
            <div
              key={`float-${index}`}
              className="pointer-events-none absolute"
              style={{
                left: item.leftPx - frame.left,
                top: item.topPx - frame.top,
                zIndex: item.behind ? 0 : 2,
              }}
            >
              <PageDrawing
                xml={item.xml}
                ignoreAnchor
                imageUrl={partName ? imageUrls[partName] : undefined}
                fallbackLabel="Document image"
              />
            </div>
          )
        })}
        {pageTextBoxes.map((box, index) => (
          <div
            key={`txbx-${index}`}
            className="pointer-events-none absolute overflow-hidden"
            style={{
              left: box.leftPx - frame.left,
              top: box.topPx - frame.top,
              width: box.widthPx,
              height: box.heightPx,
              backgroundColor: box.fill,
              color: contrastFillText(box.fill),
              zIndex: box.behind ? 0 : 2,
            }}
          >
            {box.paragraphIds.flatMap((id) => {
              const paragraph = story.paragraphs.find((item) => item.id === id)
              if (!paragraph) return []
              return [
                <ModelParagraph
                  key={paragraph.id}
                  paragraph={paragraph}
                  changes={model.changes}
                  selected={false}
                  onSelect={() => undefined}
                  drafts={drafts}
                  editing={false}
                  storyPartName={story.partName}
                  relationships={model.relationships}
                  imageUrls={imageUrls}
                  styles={model.styles}
                />,
              ]
            })}
          </div>
        ))}
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

function renderBlock(
  block: LaidOutBlock,
  index: number,
  ctx: {
    model: DocumentModelWire
    storyPartName: string
    selectedParagraphId: string | null
    onSelectParagraph: (paragraphId: string, offset?: number) => void
    drafts?: Record<string, string>
    onRunTextChange?: (runId: string, text: string) => void
    editing?: boolean
    presence?: DocumentPresence[]
    currentUserId?: string
    inserts: LocalInsert[]
    deletedParagraphIds: string[]
    onInsertTextChange?: (clientId: string, text: string) => void
    onInsertParagraph?: (afterParagraphId: string) => void
    onDeleteParagraph?: (paragraphId: string) => void
    onJoinPrevious?: (paragraphId: string) => boolean | void
    onWordEdit?: (edit: ParagraphWordEdit) => void
    restoreCaret?: { paragraphId: string; offset: number } | null
    imageUrls: Record<string, string>
    paragraphs: DocumentParagraphWire[]
    listMarkers: ReturnType<typeof documentListMarkers>
    noteMarks: Map<string, { mark: string; kind: NoteKind }>
    noteParagraphIds: Set<string>
  },
) {
  if (block.type === 'table') {
    const nodes = [
      <PageTable
        key={`tbl-${index}`}
        table={block.table}
        renderCell={(cell) =>
          cell.paragraphIds.flatMap((id) => {
            const paragraph = ctx.paragraphs.find((item) => item.id === id)
            if (!paragraph || ctx.deletedParagraphIds.includes(paragraph.id)) {
              return []
            }
            return [
              <ModelParagraph
                key={paragraph.id}
                paragraph={paragraph}
                changes={ctx.model.changes}
                selected={ctx.selectedParagraphId === paragraph.id}
                onSelect={() => ctx.onSelectParagraph(paragraph.id)}
                drafts={ctx.drafts}
                onRunTextChange={ctx.onRunTextChange}
                onInsertParagraph={ctx.onInsertParagraph}
                onDeleteParagraph={ctx.onDeleteParagraph}
                onJoinPrevious={ctx.onJoinPrevious}
                onWordEdit={ctx.onWordEdit}
                restoreCaret={ctx.restoreCaret}
                editing={ctx.editing}
                presence={ctx.presence}
                currentUserId={ctx.currentUserId}
                storyPartName={ctx.storyPartName}
                relationships={ctx.model.relationships}
                imageUrls={ctx.imageUrls}
                styles={ctx.model.styles}
                listMarker={ctx.listMarkers.get(paragraph.id)}
                noteMark={ctx.noteMarks.get(paragraph.id)?.mark}
                noteKind={ctx.noteMarks.get(paragraph.id)?.kind}
              />,
            ]
          })
        }
      />,
    ]
    return nodes
  }

  const paragraph = block.paragraph
  if (ctx.deletedParagraphIds.includes(paragraph.id)) return []
  const insert = ctx.inserts.find((item) => item.clientId === paragraph.id)
  if (insert) {
    return [
      <PendingInsert
        key={insert.clientId}
        insert={insert}
        selected={ctx.selectedParagraphId === insert.clientId}
        onSelect={() => ctx.onSelectParagraph(insert.clientId)}
        onTextChange={ctx.onInsertTextChange}
        onInsertParagraph={ctx.onInsertParagraph}
        onDeleteParagraph={ctx.onDeleteParagraph}
        onJoinPrevious={ctx.onJoinPrevious}
        onWordEdit={ctx.onWordEdit}
        restoreCaret={ctx.restoreCaret}
      />,
    ]
  }
  return [
    <ModelParagraph
      key={`${paragraph.id}-${block.from ?? 0}`}
      paragraph={paragraph}
      changes={ctx.model.changes}
      selected={ctx.selectedParagraphId === paragraph.id}
      onSelect={() => ctx.onSelectParagraph(paragraph.id)}
      drafts={ctx.drafts}
      onRunTextChange={ctx.onRunTextChange}
      onInsertParagraph={ctx.onInsertParagraph}
      onDeleteParagraph={ctx.onDeleteParagraph}
      onJoinPrevious={ctx.onJoinPrevious}
      onWordEdit={ctx.onWordEdit}
      restoreCaret={ctx.restoreCaret}
      editing={ctx.editing && !ctx.noteParagraphIds.has(paragraph.id)}
      presence={ctx.presence}
      currentUserId={ctx.currentUserId}
      storyPartName={ctx.storyPartName}
      relationships={ctx.model.relationships}
      imageUrls={ctx.imageUrls}
      styles={ctx.model.styles}
      from={block.from}
      to={block.to}
      padLeftPx={block.padLeftPx}
      padRightPx={block.padRightPx}
      wrapWidthPx={block.wrapWidthPx}
      continuation={block.continuation}
      pageStart={block.pageStart}
      listMarker={ctx.listMarkers.get(paragraph.id)}
      noteMark={ctx.noteMarks.get(paragraph.id)?.mark}
      noteKind={ctx.noteMarks.get(paragraph.id)?.kind}
    />,
  ]
}

function pageClickCaret(
  root: HTMLElement,
  clientY: number,
  endOffset: (paragraphId: string) => number,
): { paragraphId: string; offset: number } | undefined {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-paragraph-id]')]
  let best: { paragraphId: string; offset: number; dist: number } | undefined
  for (const node of nodes) {
    const paragraphId = node.dataset.paragraphId
    if (!paragraphId) continue
    const box = node.getBoundingClientRect()
    const dist =
      clientY < box.top
        ? box.top - clientY
        : clientY > box.bottom
          ? clientY - box.bottom
          : 0
    const offset =
      clientY < box.top + box.height / 2 ? 0 : endOffset(paragraphId)
    if (!best || dist < best.dist) best = { paragraphId, offset, dist }
  }
  return best
}

function blockEndOffset(
  paragraphId: string,
  paragraphs: DocumentParagraphWire[],
  drafts: Record<string, string> | undefined,
  inserts: LocalInsert[],
): number {
  const insert = inserts.find((item) => item.clientId === paragraphId)
  if (insert) return insertPlainText(insert).length
  const paragraph = paragraphs.find((item) => item.id === paragraphId)
  return paragraph ? paragraphPlainText(paragraph, drafts).length : 0
}
