import type {
  DocumentParagraphWire,
  DocumentRelationshipWire,
  DocumentStoryWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import { paragraphPlainText } from '../../document-model-text'
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

export function PageMarginBand({
  stories,
  label,
  edge,
  relationships = [],
  imageUrls = {},
  styles = [],
  padding,
  className,
}: {
  stories: DocumentStoryWire[]
  label: string
  edge: 'top' | 'bottom'
  relationships?: DocumentRelationshipWire[]
  imageUrls?: Record<string, string>
  styles?: DocumentStyleWire[]
  padding: { left: number; right: number; edge: number }
  className?: string
}) {
  const visible = stories.filter(marginStoryVisible)
  if (visible.length === 0) return null

  const Tag = edge === 'top' ? 'header' : 'footer'
  const imageLabel = edge === 'top' ? 'Header image' : 'Footer image'
  return (
    <Tag aria-label={label} className={cn('shrink-0', className)}>
      {visible.map((story) => (
        <MarginStory
          key={story.partName}
          story={story}
          imageLabel={imageLabel}
          relationships={relationships}
          imageUrls={imageUrls}
          styles={styles}
          inset={padding}
        />
      ))}
    </Tag>
  )
}

function MarginStory({
  story,
  imageLabel,
  relationships,
  imageUrls,
  styles,
  inset,
}: {
  story: DocumentStoryWire
  imageLabel: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  styles: DocumentStyleWire[]
  inset: { left: number; right: number; edge: number }
}) {
  const paragraphs = new Map(
    story.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  const blocks = storyBlocks(story)
  const tables = blocks
    .filter((block) => block.type === 'table')
    .map((block) => block.table)
  const letterhead = headerLetterhead(story, tables)
  const footer = footerLetterhead(story)
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
      paragraphPlainText(block.paragraph).trim().length > 0 ||
      paragraphImageXml(block.paragraph).length > 0 ||
      block.paragraph.runs.some((run) => runDisplayText(run))
    )
  })

  return (
    <div style={bandFill && !footer ? { backgroundColor: bandFill } : undefined}>
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
                    imageLabel={imageLabel}
                    storyPartName={story.partName}
                    relationships={relationships}
                    imageUrls={imageUrls}
                    styles={styles}
                    background={cell.fill ?? bandFill}
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
              imageLabel={imageLabel}
              storyPartName={story.partName}
              relationships={relationships}
              imageUrls={imageUrls}
              styles={styles}
              background={bandFill}
            />
          </div>
        ),
      )}
    </div>
  )
}

function MarginParagraph({
  paragraph,
  imageLabel,
  storyPartName,
  relationships,
  imageUrls,
  styles,
  background,
}: {
  paragraph: DocumentParagraphWire
  imageLabel: string
  storyPartName: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  styles: DocumentStyleWire[]
  background?: string
}) {
  const face = paragraphFace(paragraph, styles)
  const images = paragraphImageXml(paragraph).filter(
    (xml) =>
      !drawingIsTextBox(xml) &&
      (!background || !paragraphIsShapeOnly(paragraph)),
  )
  const columns = tabColumns(paragraph)
  const stops = paragraphTabStops(paragraph)
  const fill = background ?? paragraphFill(paragraph)
  const runs = (items: typeof paragraph.runs) =>
    items.map((run) => {
      const text = runDisplayText(run)
      if (!text) return null
      const faceRun = runFace(run, face, styles)
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
        images.length > 1 ? 'flex-row items-center justify-between' : 'flex-col',
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
      ) : paragraph.runs.some((run) => runDisplayText(run)) ? (
        <p>{runs(paragraph.runs)}</p>
      ) : null}
    </div>
  )
}
