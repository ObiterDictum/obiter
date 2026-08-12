import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentPresence,
} from '@obiter/contracts'
import type { LocalInsert } from '../../document-edits'
import {
  contrastFillText,
  imagePartNameForDrawing,
} from '../../document-page-media'
import {
  documentPageBox,
  marginStories,
  contentFrame,
} from '../../document-page-layout'
import { storyBlocks } from '../../document-page-tables'
import type { LaidOutBlock } from '../../document-page-engine'
import type { PageFloat, PageTextBox } from '../../document-page-floats'
import { ModelParagraph, PendingInsert } from './model-paragraph'
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
  imageUrls = {},
  pageBlocks,
  pageFloats = [],
  pageTextBoxes = [],
  pageColumns,
}: {
  model: DocumentModelWire
  selectedParagraphId: string | null
  onSelectParagraph: (paragraphId: string) => void
  drafts?: Record<string, string>
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  inserts?: LocalInsert[]
  deletedParagraphIds?: string[]
  onInsertTextChange?: (clientId: string, text: string) => void
  imageUrls?: Record<string, string>
  pageBlocks?: LaidOutBlock[]
  pageFloats?: PageFloat[]
  pageTextBoxes?: PageTextBox[]
  pageColumns?: Array<{ left: number; widthPx: number }>
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
  const columns = pageColumns ?? [
    { left: 0, widthPx: contentFrame(page).widthPx },
  ]
  const firstColumn = columns[0]
  const nextColumn = columns[1]
  const gap =
    firstColumn && nextColumn ? nextColumn.left - firstColumn.widthPx : 0

  return (
    <div
      className="relative flex flex-1 flex-col"
      style={{ height: page.heightPx, minHeight: page.heightPx }}
    >
      <PageMarginBand
        stories={headers}
        label="Document header"
        edge="top"
        className="pointer-events-none absolute inset-x-0 top-0 z-[1]"
        relationships={model.relationships}
        imageUrls={imageUrls}
        styles={model.styles}
        padding={{
          left: page.margin.left,
          right: page.margin.right,
          edge: page.headerPx,
        }}
      />
      <div
        className="relative z-[1] flex flex-1"
        style={{
          paddingLeft: page.margin.left,
          paddingRight: page.margin.right,
          paddingTop: page.margin.top,
          paddingBottom: page.margin.bottom,
          gap,
        }}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={`col-${columnIndex}`}
            className="flex flex-col"
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
                  imageUrls,
                  paragraphs: story.paragraphs,
                }),
              )}
          </div>
        ))}
      </div>
      <PageMarginBand
        stories={footers}
        label="Document footer"
        edge="bottom"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1]"
        relationships={model.relationships}
        imageUrls={imageUrls}
        styles={model.styles}
        padding={{
          left: page.margin.left,
          right: page.margin.right,
          edge: page.footerPx,
        }}
      />
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
              left: item.leftPx,
              top: item.topPx,
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
            left: box.leftPx,
            top: box.topPx,
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
  )
}

function renderBlock(
  block: LaidOutBlock,
  index: number,
  ctx: {
    model: DocumentModelWire
    storyPartName: string
    selectedParagraphId: string | null
    onSelectParagraph: (paragraphId: string) => void
    drafts?: Record<string, string>
    onRunTextChange?: (runId: string, text: string) => void
    editing?: boolean
    presence?: DocumentPresence[]
    currentUserId?: string
    inserts: LocalInsert[]
    deletedParagraphIds: string[]
    onInsertTextChange?: (clientId: string, text: string) => void
    imageUrls: Record<string, string>
    paragraphs: DocumentParagraphWire[]
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
                editing={ctx.editing}
                presence={ctx.presence}
                currentUserId={ctx.currentUserId}
                storyPartName={ctx.storyPartName}
                relationships={ctx.model.relationships}
                imageUrls={ctx.imageUrls}
                styles={ctx.model.styles}
              />,
            ]
          })
        }
      />,
    ]
    for (const paragraphId of block.table.paragraphIds) {
      for (const insert of ctx.inserts.filter(
        (item) => item.afterParagraphId === paragraphId,
      )) {
        nodes.push(
          <PendingInsert
            key={insert.clientId}
            insert={insert}
            selected={ctx.selectedParagraphId === insert.clientId}
            onSelect={() => ctx.onSelectParagraph(insert.clientId)}
            onTextChange={ctx.onInsertTextChange}
          />,
        )
      }
    }
    return nodes
  }

  const paragraph = block.paragraph
  if (ctx.deletedParagraphIds.includes(paragraph.id)) return []
  const nodes = [
    <ModelParagraph
      key={`${paragraph.id}-${block.from ?? 0}`}
      paragraph={paragraph}
      changes={ctx.model.changes}
      selected={ctx.selectedParagraphId === paragraph.id}
      onSelect={() => ctx.onSelectParagraph(paragraph.id)}
      drafts={ctx.drafts}
      onRunTextChange={ctx.onRunTextChange}
      editing={ctx.editing}
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
      continuation={block.continuation}
    />,
  ]
  if (!block.continuation) {
    for (const insert of ctx.inserts.filter(
      (item) => item.afterParagraphId === paragraph.id,
    )) {
      nodes.push(
        <PendingInsert
          key={insert.clientId}
          insert={insert}
          selected={ctx.selectedParagraphId === insert.clientId}
          onSelect={() => ctx.onSelectParagraph(insert.clientId)}
          onTextChange={ctx.onInsertTextChange}
        />,
      )
    }
  }
  return nodes
}
