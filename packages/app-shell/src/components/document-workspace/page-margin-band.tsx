import { effectiveParagraph } from '../../document-model-text'
import { useMemo } from 'react'
import {
  pendingParagraphChanges,
  type PendingRedlineModel,
} from '../../document-pending-redlines'
import { inlineChanges } from '../../document-inline-changes'
import { InlineChange } from './inline-change-review'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentRelationshipWire,
  DocumentStoryWire,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import type { LaidOutBlock } from '../../document-page-engine'
import {
  contrastFillText,
  drawingIsTextBox,
  imagePartNameForDrawing,
  marginStoryVisible,
  paragraphFill,
  paragraphImageXml,
  readableRunColor,
  runDisplayText,
  tabColumns,
} from '../../document-page-media'
import {
  footerBandFill,
  footerLetterhead,
  headerLetterhead,
  marginStoryRevised,
  paragraphIsDrawingOnly,
  paragraphIsShapeOnly,
  paragraphTabStops,
} from '../../document-page-margin'
import {
  paragraphCss,
  paragraphFace,
  runCss,
  runFace,
} from '../../document-page-style'
import { storyBlocks } from '../../document-page-tables'
import { FooterBand, LetterheadBar, TabLine } from './page-letterhead'
import { PageDrawing } from './page-drawing'
import { PageTable } from './page-table'
import { renderBlock, type BlockContext } from './model-page-blocks'

/**
 * The header/footer story open for editing on this page: its laid-out blocks
 * and the render context `renderBlock` needs — the same machinery the body
 * column uses, so the band edits through `ModelParagraph` rather than a
 * second editor.
 */
export type EditableMargin = {
  partName: string
  blocks: LaidOutBlock[]
  ctx: BlockContext
}

export function PageMarginBand({
  stories,
  changes = [],
  drafts,
  extraRuns,
  pendingRedlines = {},
  label,
  edge,
  relationships = [],
  imageUrls = {},
  styles = [],
  padding,
  className,
  pageNumber = 1,
  heightPx,
  editable,
}: {
  stories: DocumentStoryWire[]
  drafts?: Record<string, string>
  extraRuns?: Record<string, DocumentTextRunWire[]>
  pendingRedlines?: Partial<PendingRedlineModel>
  changes?: DocumentChangeWire[]
  label: string
  edge: 'top' | 'bottom'
  relationships?: DocumentRelationshipWire[]
  imageUrls?: Record<string, string>
  styles?: DocumentStyleWire[]
  padding: { left: number; right: number; edge: number }
  className?: string
  pageNumber?: number
  heightPx?: number
  /** The story open for editing; painted through the editable path even when
   * it holds no visible content, so an empty header still takes the caret. */
  editable?: EditableMargin
}) {
  const effective = useMemo(
    () =>
      drafts || extraRuns
        ? stories.map((story) => ({
            ...story,
            paragraphs: story.paragraphs.map((paragraph) =>
              effectiveParagraph(paragraph, drafts, extraRuns?.[paragraph.id]),
            ),
          }))
        : stories,
    [stories, drafts, extraRuns],
  )
  const visible = effective.filter(
    (story) =>
      marginStoryVisible(story) ||
      story.partName === editable?.partName ||
      marginStoryRevised(story, changes),
  )
  const Tag = edge === 'top' ? 'header' : 'footer'
  if (visible.length === 0) {
    if (!heightPx) return null
    return (
      <Tag
        aria-label={label}
        className={cn('shrink-0 overflow-hidden', className)}
        style={{ height: heightPx }}
      />
    )
  }

  const imageLabel = edge === 'top' ? 'Header image' : 'Footer image'
  return (
    <Tag
      aria-label={label}
      className={cn('shrink-0 overflow-hidden', className)}
      style={heightPx ? { height: heightPx } : undefined}
    >
      {visible.map((story) =>
        story.partName === editable?.partName ? (
          <EditableMarginStory
            key={story.partName}
            editable={editable}
            inset={padding}
          />
        ) : (
          <MarginStory
            key={story.partName}
            story={story}
            changes={changes}
            pendingRedlines={pendingRedlines}
            imageLabel={imageLabel}
            relationships={relationships}
            imageUrls={imageUrls}
            styles={styles}
            inset={padding}
            pageNumber={pageNumber}
          />
        ),
      )}
    </Tag>
  )
}

/**
 * The open margin story, painted with the same block renderer the body uses.
 * Every paragraph shows — including empty ones, which the read-only band
 * hides — so the caret has somewhere to land; a letterhead or footer shape
 * band reads as its plain paragraphs while it is being edited.
 */
function EditableMarginStory({
  editable,
  inset,
}: {
  editable: EditableMargin
  inset: { left: number; right: number; edge: number }
}) {
  const widthPx = Math.max(
    1,
    editable.ctx.columnWidthPx - inset.left - inset.right,
  )
  return (
    <div>
      {editable.blocks.map((block, index) => {
        const wrapWidthPx =
          block.type === 'paragraph'
            ? Math.max(
                1,
                widthPx -
                  (paragraphFace(block.paragraph, editable.ctx.model.styles)
                    .indentLeftPx ?? 0) -
                  (paragraphFace(block.paragraph, editable.ctx.model.styles)
                    .indentRightPx ?? 0),
              )
            : undefined
        return (
          <div
            key={
              block.type === 'paragraph' ? block.paragraph.id : `tbl-${index}`
            }
            style={{
              paddingLeft: inset.left,
              paddingRight: inset.right,
              paddingTop: index === 0 ? inset.edge : 0,
            }}
          >
            {renderBlock(
              block.type === 'paragraph' && wrapWidthPx !== undefined
                ? { ...block, wrapWidthPx }
                : block,
              index,
              editable.ctx,
            )}
          </div>
        )
      })}
    </div>
  )
}

function MarginStory({
  story,
  changes,
  pendingRedlines,
  imageLabel,
  relationships,
  imageUrls,
  styles,
  inset,
  pageNumber,
}: {
  story: DocumentStoryWire
  pendingRedlines: Partial<PendingRedlineModel>
  changes: DocumentChangeWire[]
  imageLabel: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  styles: DocumentStyleWire[]
  inset: { left: number; right: number; edge: number }
  pageNumber: number
}) {
  const paragraphs = new Map(
    story.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  const blocks = storyBlocks(story)
  const tables = blocks
    .filter((block) => block.type === 'table')
    .map((block) => block.table)
  const revised = marginStoryRevised(story, changes)
  const letterhead = revised ? undefined : headerLetterhead(story, tables)
  const footer = revised ? undefined : footerLetterhead(story, pageNumber)
  const bandFill = footer?.fill ?? footerBandFill(story, tables)
  const painted =
    Boolean(bandFill) ||
    tables.some((table) =>
      table.rows.some((row) => row.cells.some((cell) => cell.fill)),
    )
  const skip = new Set<string>()
  if (letterhead || footer) {
    for (const paragraph of story.paragraphs) {
      if (paragraphIsDrawingOnly(paragraph)) skip.add(paragraph.id)
    }
  }
  if (footer) {
    for (const paragraph of story.paragraphs) skip.add(paragraph.id)
  }
  if (painted) {
    for (const paragraph of story.paragraphs) {
      if (paragraphIsShapeOnly(paragraph)) skip.add(paragraph.id)
    }
  }

  const visible = blocks.filter((block) => {
    if (block.type === 'table') {
      if (letterhead) return false
      return true
    }
    if (skip.has(block.paragraph.id)) return false
    return (
      inlineChanges(
        block.paragraph,
        changes,
        story.partName,
        pendingParagraphChanges(
          pendingRedlines,
          block.paragraph.id,
          story.partName,
        ),
      ).text.trim().length > 0 ||
      paragraphImageXml(block.paragraph).length > 0 ||
      block.paragraph.runs.some((run) => runDisplayText(run, pageNumber))
    )
  })

  return (
    <div
      style={bandFill && !footer ? { backgroundColor: bandFill } : undefined}
    >
      {letterhead ? (
        <LetterheadBar
          letterhead={letterhead}
          imageLabel={imageLabel}
          storyPartName={story.partName}
          relationships={relationships}
          imageUrls={imageUrls}
        />
      ) : null}
      {footer ? <FooterBand letterhead={footer} inset={inset} /> : null}
      {visible.map((block, index) =>
        block.type === 'table' ? (
          <PageTable
            key={`${story.partName}-tbl-${index}`}
            table={block.table}
            renderCell={(cell) =>
              cell.paragraphIds.map((id) => {
                const paragraph = paragraphs.get(id)
                return paragraph ? (
                  <MarginParagraph
                    key={id}
                    paragraph={paragraph}
                    changes={changes}
                    pendingRedlines={pendingRedlines}
                    imageLabel={imageLabel}
                    storyPartName={story.partName}
                    relationships={relationships}
                    imageUrls={imageUrls}
                    styles={styles}
                    background={cell.fill ?? bandFill}
                    pageNumber={pageNumber}
                  />
                ) : null
              })
            }
          />
        ) : (
          <div
            key={block.paragraph.id}
            style={{
              paddingLeft: paragraphIsDrawingOnly(block.paragraph)
                ? 0
                : inset.left,
              paddingRight: paragraphIsDrawingOnly(block.paragraph)
                ? 0
                : inset.right,
              paddingTop: index === 0 && !letterhead ? inset.edge : 0,
            }}
          >
            <MarginParagraph
              paragraph={block.paragraph}
              changes={changes}
              pendingRedlines={pendingRedlines}
              imageLabel={imageLabel}
              storyPartName={story.partName}
              relationships={relationships}
              imageUrls={imageUrls}
              styles={styles}
              background={bandFill}
              pageNumber={pageNumber}
            />
          </div>
        ),
      )}
    </div>
  )
}

function MarginParagraph({
  paragraph,
  changes,
  pendingRedlines,
  imageLabel,
  storyPartName,
  relationships,
  imageUrls,
  styles,
  background,
  pageNumber,
}: {
  paragraph: DocumentParagraphWire
  pendingRedlines: Partial<PendingRedlineModel>
  changes: DocumentChangeWire[]
  imageLabel: string
  storyPartName: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  styles: DocumentStyleWire[]
  background?: string
  pageNumber: number
}) {
  const face = paragraphFace(paragraph, styles)
  const images = paragraphImageXml(paragraph).filter(
    (xml) =>
      !drawingIsTextBox(xml) &&
      (!background || !paragraphIsShapeOnly(paragraph)),
  )
  const projection = inlineChanges(
    paragraph,
    changes,
    storyPartName,
    pendingParagraphChanges(pendingRedlines, paragraph.id, storyPartName),
  )
  const projected = projection.paragraph
  const spans = new Map(projection.spans.map((span) => [span.runId, span]))
  const columns = tabColumns(projected)
  const stops = paragraphTabStops(paragraph)
  const fill = background ?? paragraphFill(paragraph)
  const runs = (items: typeof paragraph.runs) =>
    items.map((run) => {
      const text = runDisplayText(run, pageNumber)
      if (!text) return null
      const span = spans.get(run.id)
      const faceRun = runFace(
        projection.runSources.get(run.id)?.run ?? run,
        face,
        styles,
      )
      if (span)
        return (
          <InlineChange
            key={run.id}
            span={span}
            text={text}
            tabStop={span.tabStop}
          >
            {span.pending ? (
              <span
                style={runCss({
                  ...faceRun,
                  color: 'inherit',
                })}
              >
                {text}
              </span>
            ) : undefined}
          </InlineChange>
        )
      const color =
        readableRunColor(faceRun.color, fill) ?? contrastFillText(fill)
      return (
        <span key={run.id} style={runCss({ ...faceRun, color })}>
          {text}
        </span>
      )
    })

  return (
    <div
      className={cn(
        'flex min-h-[1em] self-start',
        images.length > 1
          ? 'flex-row items-center justify-between'
          : 'flex-col',
        face.align === 'center' && 'items-center',
        face.align === 'right' && 'items-end',
      )}
      style={{
        ...paragraphCss(face),
        ...(fill && !background ? { backgroundColor: fill } : {}),
      }}
    >
      {images.map((xml, index) => {
        const partName = imagePartNameForDrawing(
          xml,
          storyPartName,
          relationships,
        )
        return (
          <PageDrawing
            key={`${paragraph.id}-img-${index}`}
            xml={xml}
            imageUrl={partName ? imageUrls[partName] : undefined}
            fallbackLabel={imageLabel}
          />
        )
      })}
      {columns && columns.length > 1 ? (
        <TabLine columns={columns} stops={stops} render={runs} />
      ) : projected.runs.some((run) => runDisplayText(run, pageNumber)) ? (
        <p>{runs(projected.runs)}</p>
      ) : null}
    </div>
  )
}
