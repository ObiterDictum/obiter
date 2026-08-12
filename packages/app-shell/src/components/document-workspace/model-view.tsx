import type {
  DocumentChangeWire,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentRelationshipWire,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import type { LocalInsert } from '../../document-edits'
import { runChangeKinds } from '../../document-model-text'
import {
  imagePartNameForDrawing,
  paragraphImageXml,
  readableRunColor,
} from '../../document-page-media'
import { documentPageBox, marginStories } from '../../document-page-layout'
import {
  paragraphCss,
  paragraphFace,
  runCss,
  runFace,
  type RunFace,
} from '../../document-page-style'
import { storyBlocks } from '../../document-page-tables'
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

  return (
    <div
      className="relative flex flex-1 flex-col"
      style={{ minHeight: page.heightPx }}
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
        className="flex flex-1 flex-col"
        style={{
          paddingLeft: page.margin.left,
          paddingRight: page.margin.right,
          paddingTop: page.margin.top,
          paddingBottom: page.margin.bottom,
        }}
      >
        {storyBlocks(story).flatMap((block, index) => {
          if (block.type === 'table') {
            const nodes = [
              <PageTable
                key={`tbl-${index}`}
                table={block.table}
                renderCell={(cell) =>
                  cell.paragraphIds.flatMap((id) => {
                    const paragraph = story.paragraphs.find(
                      (item) => item.id === id,
                    )
                    if (
                      !paragraph ||
                      deletedParagraphIds.includes(paragraph.id)
                    ) {
                      return []
                    }
                    return [
                      <ModelParagraph
                        key={paragraph.id}
                        paragraph={paragraph}
                        changes={model.changes}
                        selected={selectedParagraphId === paragraph.id}
                        onSelect={() => onSelectParagraph(paragraph.id)}
                        drafts={drafts}
                        onRunTextChange={onRunTextChange}
                        editing={editing}
                        presence={presence}
                        currentUserId={currentUserId}
                        storyPartName={story.partName}
                        relationships={model.relationships}
                        imageUrls={imageUrls}
                        styles={model.styles}
                      />,
                    ]
                  })
                }
              />,
            ]
            for (const paragraphId of block.table.paragraphIds) {
              for (const insert of inserts.filter(
                (item) => item.afterParagraphId === paragraphId,
              )) {
                nodes.push(
                  <PendingInsert
                    key={insert.clientId}
                    insert={insert}
                    selected={selectedParagraphId === insert.clientId}
                    onSelect={() => onSelectParagraph(insert.clientId)}
                    onTextChange={onInsertTextChange}
                  />,
                )
              }
            }
            return nodes
          }

          const paragraph = block.paragraph
          if (deletedParagraphIds.includes(paragraph.id)) return []
          const nodes = [
            <ModelParagraph
              key={paragraph.id}
              paragraph={paragraph}
              changes={model.changes}
              selected={selectedParagraphId === paragraph.id}
              onSelect={() => onSelectParagraph(paragraph.id)}
              drafts={drafts}
              onRunTextChange={onRunTextChange}
              editing={editing}
              presence={presence}
              currentUserId={currentUserId}
              storyPartName={story.partName}
              relationships={model.relationships}
              imageUrls={imageUrls}
              styles={model.styles}
            />,
          ]
          for (const insert of inserts.filter(
            (item) => item.afterParagraphId === paragraph.id,
          )) {
            nodes.push(
              <PendingInsert
                key={insert.clientId}
                insert={insert}
                selected={selectedParagraphId === insert.clientId}
                onSelect={() => onSelectParagraph(insert.clientId)}
                onTextChange={onInsertTextChange}
              />,
            )
          }
          return nodes
        })}
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
    </div>
  )
}

function ModelParagraph({
  paragraph,
  changes,
  selected,
  onSelect,
  drafts,
  onRunTextChange,
  editing,
  presence,
  currentUserId,
  storyPartName,
  relationships,
  imageUrls,
  styles,
}: {
  paragraph: DocumentParagraphWire
  changes: DocumentChangeWire[]
  selected: boolean
  onSelect: () => void
  drafts?: Record<string, string>
  onRunTextChange?: (runId: string, text: string) => void
  editing?: boolean
  presence?: DocumentPresence[]
  currentUserId?: string
  storyPartName: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  styles: DocumentStyleWire[]
}) {
  const carets = (presence ?? []).filter(
    (item) =>
      item.userId !== currentUserId &&
      item.cursor?.paragraphId === paragraph.id,
  )
  const face = paragraphFace(paragraph, styles)
  const fullWidth = paragraph.runs.length <= 1
  const images = paragraphImageXml(paragraph)

  return (
    <div
      aria-current={selected ? 'true' : undefined}
      aria-label={`Paragraph ${paragraph.id}`}
      onClick={onSelect}
      className={cn(
        'relative w-full',
        face.align === 'left' && 'text-left',
        face.align === 'right' && 'text-right',
        face.align === 'center' && 'text-center',
        face.align === 'justify' && 'text-justify',
        selected && 'shadow-[inset_2px_0_0_#5a6f88]',
      )}
      style={paragraphCss(face)}
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
            fallbackLabel="Document image"
          />
        )
      })}
      <p
        className="min-h-[1em] w-full"
        style={{ textAlign: face.align ?? 'left' }}
      >
        {paragraph.runs.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          paragraph.runs.map((run) => (
            <ModelRun
              key={run.id}
              run={run}
              face={runFace(run, face, styles)}
              kinds={runChangeKinds(changes, run.id)}
              draft={drafts?.[run.id]}
              editing={editing}
              fullWidth={fullWidth}
              align={face.align}
              onTextChange={onRunTextChange}
              caret={carets.find((item) => item.cursor?.runId === run.id)}
            />
          ))
        )}
      </p>
    </div>
  )
}

function ModelRun({
  run,
  face,
  kinds,
  draft,
  editing,
  fullWidth,
  align,
  onTextChange,
  caret,
}: {
  run: DocumentTextRunWire
  face: RunFace
  kinds: Set<DocumentChangeWire['kind']>
  draft?: string
  editing?: boolean
  fullWidth: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  onTextChange?: (runId: string, text: string) => void
  caret?: DocumentPresence
}) {
  const text = draft ?? run.text
  const color = readableRunColor(face.color)
  const className = cn(
    kinds.has('insert') && 'underline decoration-[#3d7a52] underline-offset-4',
    kinds.has('delete') && 'text-[#9a4f3c] line-through decoration-[#9a4f3c]',
    kinds.has('move') && 'underline decoration-dotted decoration-[#4a6f8a]',
    kinds.has('property') && 'underline decoration-dotted decoration-[#8a6a2a]',
  )
  const textAlign = align ?? 'left'
  const style = { ...runCss({ ...face, color }), textAlign }

  if (editing && onTextChange) {
    return (
      <span className={cn('relative', fullWidth && 'w-full')} style={{ textAlign }}>
        {caret ? <PresenceCaret userId={caret.userId} /> : null}
        <textarea
          aria-label="Run text"
          value={text}
          rows={1}
          onChange={(event) => onTextChange(run.id, event.target.value)}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'resize-none overflow-hidden bg-transparent p-0 text-inherit',
            'field-sizing-content border-0 outline-none focus-visible:ring-0',
            fullWidth ? 'block w-full' : 'inline align-baseline',
            className,
          )}
          style={style}
        />
      </span>
    )
  }

  return (
    <span className={cn('relative', className)} style={style}>
      {caret ? <PresenceCaret userId={caret.userId} /> : null}
      {text}
    </span>
  )
}

function PresenceCaret({ userId }: { userId: string }) {
  return (
    <span
      className="absolute top-0 -left-px h-full w-px bg-[#4a6f8a]"
      title={userId}
      aria-hidden="true"
    />
  )
}

function PendingInsert({
  insert,
  selected,
  onSelect,
  onTextChange,
}: {
  insert: LocalInsert
  selected: boolean
  onSelect: () => void
  onTextChange?: (clientId: string, text: string) => void
}) {
  return (
    <div
      aria-current={selected ? 'true' : undefined}
      aria-label="Pending paragraph"
      onClick={onSelect}
      className={cn(
        'relative',
        selected ? 'shadow-[inset_2px_0_0_#5a6f88]' : 'shadow-[inset_2px_0_0_#c5c1b8]',
      )}
    >
      <textarea
        aria-label="Pending paragraph text"
        value={insert.text}
        rows={1}
        onChange={(event) =>
          onTextChange?.(insert.clientId, event.target.value)
        }
        onClick={(event) => event.stopPropagation()}
        className="field-sizing-content block w-full resize-none overflow-hidden bg-transparent p-0 text-inherit outline-none"
      />
    </div>
  )
}
