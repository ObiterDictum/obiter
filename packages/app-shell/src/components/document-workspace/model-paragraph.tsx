import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentRelationshipWire,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import type { LocalInsert } from '../../document-edits'
import {
  paragraphPlainText,
  runChangeKinds,
  sliceParagraphRuns,
} from '../../document-model-text'
import { paragraphInlineXml } from '../../document-page-floats'
import {
  imagePartNameForDrawing,
  readableRunColor,
} from '../../document-page-media'
import {
  paragraphCss,
  paragraphFace,
  runCss,
  runFace,
  type RunFace,
} from '../../document-page-style'
import { PageDrawing } from './page-drawing'

export function ModelParagraph({
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
  from,
  to,
  padLeftPx = 0,
  padRightPx = 0,
  continuation = false,
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
  from?: number
  to?: number
  padLeftPx?: number
  padRightPx?: number
  continuation?: boolean
}) {
  const carets = (presence ?? []).filter(
    (item) =>
      item.userId !== currentUserId &&
      item.cursor?.paragraphId === paragraph.id,
  )
  const face = paragraphFace(paragraph, styles)
  const fullText = paragraphPlainText(paragraph, drafts)
  const start = from ?? 0
  const end = to ?? fullText.length
  const sliced = start !== 0 || end !== fullText.length
  const fullWidth = !sliced && paragraph.runs.length <= 1
  const images = continuation ? [] : paragraphInlineXml(paragraph)
  const runs = sliced
    ? sliceParagraphRuns(paragraph, start, end, drafts)
    : paragraph.runs.map((run) => ({
        run,
        text: drafts?.[run.id] ?? run.text,
      }))

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
      )}
      style={{
        ...paragraphCss(face),
        marginTop: continuation ? 0 : face.marginTopPx,
        paddingLeft: (face.indentLeftPx ?? 0) + padLeftPx,
        paddingRight: (face.indentRightPx ?? 0) + padRightPx,
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
            fallbackLabel="Document image"
          />
        )
      })}
      <p
        className="min-h-[1em] w-full"
        style={{ textAlign: face.align ?? 'left' }}
      >
        {runs.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          runs.map(({ run, text }) => (
            <ModelRun
              key={`${run.id}-${start}`}
              run={run}
              text={sliced ? text : undefined}
              face={runFace(run, face, styles)}
              kinds={runChangeKinds(changes, run.id)}
              draft={sliced ? undefined : drafts?.[run.id]}
              editing={editing && !sliced}
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
  text: slicedText,
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
  text?: string
  face: RunFace
  kinds: Set<DocumentChangeWire['kind']>
  draft?: string
  editing?: boolean
  fullWidth: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  onTextChange?: (runId: string, text: string) => void
  caret?: DocumentPresence
}) {
  const text = slicedText ?? draft ?? run.text
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
      <span
        className={cn('relative', fullWidth && 'w-full')}
        style={{ textAlign }}
      >
        {caret ? <PresenceCaret userId={caret.userId} /> : null}
        <textarea
          aria-label="Run text"
          value={text}
          rows={1}
          spellCheck={false}
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

export function PendingInsert({
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
        selected
          ? 'shadow-[inset_2px_0_0_#5a6f88]'
          : 'shadow-[inset_2px_0_0_#c5c1b8]',
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
