import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentRelationshipWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import {
  deleteCharBeforeOffset,
  paragraphPlainText,
  runChangeKinds,
  sliceContainsOffset,
  sliceParagraphRuns,
  textDiff,
} from '../../document-model-text'
import { paragraphInlineXml } from '../../document-page-floats'
import { wrapLines } from '../../document-page-flow'
import type { ListMarker } from '../../document-page-lists'
import {
  imagePartNameForDrawing,
  readableRunColor,
} from '../../document-page-media'
import { runNoteRefs, type NoteKind } from '../../document-page-notes'
import {
  paragraphCss,
  paragraphFace,
  paragraphLineHeightPx,
  runCss,
  runFace,
  type RunFace,
} from '../../document-page-style'
import { PageDrawing } from './page-drawing'
import { ParagraphEditor } from './paragraph-editor'

export type ParagraphWordEdit = {
  type: 'replace' | 'deleteBackward' | 'deleteForward' | 'split' | 'lineBreak'
  paragraphId: string
  offset: number
  from?: number
  to?: number
  insert?: string
}

export function ModelParagraph({
  paragraph,
  changes,
  selected,
  onSelect,
  drafts,
  onRunTextChange,
  onInsertParagraph,
  onDeleteParagraph,
  onJoinPrevious,
  onWordEdit,
  restoreCaret,
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
  wrapWidthPx,
  continuation = false,
  pageStart = false,
  listMarker,
  noteMark,
  noteKind,
}: {
  paragraph: DocumentParagraphWire
  changes: DocumentChangeWire[]
  selected: boolean
  onSelect: () => void
  drafts?: Record<string, string>
  onRunTextChange?: (runId: string, text: string) => void
  onInsertParagraph?: (afterParagraphId: string) => void
  onDeleteParagraph?: (paragraphId: string) => void
  onJoinPrevious?: (paragraphId: string) => boolean | void
  onWordEdit?: (edit: ParagraphWordEdit) => void
  restoreCaret?: { paragraphId: string; offset: number } | null
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
  wrapWidthPx?: number
  continuation?: boolean
  pageStart?: boolean
  listMarker?: ListMarker
  noteMark?: string
  noteKind?: NoteKind
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
  const sliceText = fullText.slice(start, end)
  const linePx = paragraphLineHeightPx(face)
  const images = continuation ? [] : paragraphInlineXml(paragraph)
  const runs = sliced
    ? sliceParagraphRuns(paragraph, start, end, drafts)
    : paragraph.runs.map((run) => ({
        run,
        text: drafts?.[run.id] ?? run.text,
      }))
  const restore =
    restoreCaret?.paragraphId === paragraph.id &&
    sliceContainsOffset(restoreCaret.offset, start, end, fullText.length)
      ? restoreCaret.offset - start
      : undefined
  const lines =
    wrapWidthPx && wrapWidthPx > 0
      ? wrapLines(
          sliceText,
          face.run.fontSizePx ?? linePx,
          wrapWidthPx,
          face.run.fontFamily,
        )
      : [{ text: sliceText, from: 0, to: sliceText.length }]
  const editorHeight = lines.length * linePx
  const holdsCaret =
    Boolean(editing) &&
    selected &&
    (restore !== undefined ||
      restoreCaret == null ||
      restoreCaret.paragraphId !== paragraph.id)
  const indentLeftPx = listMarker
    ? Math.max(0, listMarker.leftPx - listMarker.hangingPx)
    : (face.indentLeftPx ?? 0)
  const markerWidth = listMarker?.hangingPx ?? 0

  return (
    <div
      data-paragraph-id={paragraph.id}
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
        lineHeight: `${linePx}px`,
        marginTop: continuation || pageStart ? 0 : face.marginTopPx,
        paddingLeft: indentLeftPx + padLeftPx,
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
      <div
        className="flex min-h-[1em] w-full"
        style={{ textAlign: face.align ?? 'left', lineHeight: `${linePx}px` }}
      >
        {listMarker ? (
          <span
            className="shrink-0"
            style={{
              width: markerWidth,
              fontFamily: face.run.fontFamily,
              fontSize: face.run.fontSizePx,
              lineHeight: `${linePx}px`,
            }}
          >
            {continuation
              ? ''
              : (noteMark ? `${noteMark} ` : '') + listMarker.text}
          </span>
        ) : noteMark && !continuation ? (
          <span
            className="shrink-0 pr-1 align-super text-[0.75em]"
            aria-label={
              noteKind === 'endnote'
                ? `Endnote ${noteMark}`
                : `Footnote ${noteMark}`
            }
          >
            <span aria-hidden="true">{noteMark}</span>
          </span>
        ) : null}
        <div className="min-h-[1em] min-w-0 flex-1">
          {editing && (!selected || holdsCaret) ? (
            <ParagraphEditor
              text={sliceText}
              selected={holdsCaret}
              restoreCaret={restore}
              style={{
                ...paragraphCss(face),
                marginTop: 0,
                marginBottom: 0,
                height: editorHeight,
                lineHeight: `${linePx}px`,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'normal',
                wordBreak: 'normal',
                textAlign: face.align ?? 'left',
              }}
              onSelect={onSelect}
              onChangeText={(next) => {
                const diff = textDiff(sliceText, next)
                if (onWordEdit) {
                  onWordEdit({
                    type: 'replace',
                    paragraphId: paragraph.id,
                    offset: start + diff.from,
                    from: start + diff.from,
                    to: start + diff.to,
                    insert: diff.insert,
                  })
                  return
                }
                const first = paragraph.runs[0]
                if (first) {
                  onRunTextChange?.(
                    first.id,
                    fullText.slice(0, start) + next + fullText.slice(end),
                  )
                }
              }}
              onBackspace={(local) => {
                const offset = start + local
                if (onWordEdit) {
                  onWordEdit({
                    type: 'deleteBackward',
                    paragraphId: paragraph.id,
                    offset,
                  })
                  return
                }
                if (offset > 0) {
                  const next = deleteCharBeforeOffset(paragraph, drafts, offset)
                  if (next) onRunTextChange?.(next.runId, next.text)
                  return
                }
                if (onJoinPrevious?.(paragraph.id)) return
                if (fullText.length === 0) onDeleteParagraph?.(paragraph.id)
              }}
              onDelete={(local) => {
                const offset = start + local
                if (onWordEdit) {
                  onWordEdit({
                    type: 'deleteForward',
                    paragraphId: paragraph.id,
                    offset,
                  })
                  return
                }
                if (offset < fullText.length) {
                  const next = deleteCharBeforeOffset(
                    paragraph,
                    drafts,
                    offset + 1,
                  )
                  if (next) onRunTextChange?.(next.runId, next.text)
                }
              }}
              onEnter={(local) => {
                if (onWordEdit) {
                  onWordEdit({
                    type: 'split',
                    paragraphId: paragraph.id,
                    offset: start + local,
                  })
                  return
                }
                onInsertParagraph?.(paragraph.id)
              }}
              onLineBreak={(local) => {
                if (onWordEdit) {
                  onWordEdit({
                    type: 'lineBreak',
                    paragraphId: paragraph.id,
                    offset: start + local,
                  })
                }
              }}
            />
          ) : runs.length === 0 ? (
            <span>&nbsp;</span>
          ) : wrapWidthPx && wrapWidthPx > 0 ? (
            lines.map((line, index) => (
              <div
                key={`${paragraph.id}-${start}-${line.from}-${index}`}
                className="whitespace-pre"
                style={{ height: linePx, lineHeight: `${linePx}px` }}
              >
                {line.text ? (
                  sliceParagraphRuns(
                    paragraph,
                    start + line.from,
                    start + line.to,
                    drafts,
                  ).map(({ run, text }) => (
                    <ModelRun
                      key={`${run.id}-${start}-${line.from}`}
                      text={text}
                      face={runFace(run, face, styles)}
                      kinds={runChangeKinds(changes, run.id)}
                      caret={carets.find(
                        (item) => item.cursor?.runId === run.id,
                      )}
                      notes={runEndNotes(run, text, drafts)}
                    />
                  ))
                ) : (
                  <span>&nbsp;</span>
                )}
              </div>
            ))
          ) : (
            runs.map(({ run, text }) => (
              <ModelRun
                key={`${run.id}-${start}`}
                text={text}
                face={runFace(run, face, styles)}
                kinds={runChangeKinds(changes, run.id)}
                caret={carets.find((item) => item.cursor?.runId === run.id)}
                notes={runEndNotes(run, text, drafts)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ModelRun({
  text,
  face,
  kinds,
  caret,
  notes = [],
}: {
  text: string
  face: RunFace
  kinds: Set<DocumentChangeWire['kind']>
  caret?: DocumentPresence
  notes?: ReturnType<typeof runNoteRefs>
}) {
  const color = readableRunColor(face.color)
  return (
    <span
      className={cn(
        'relative',
        kinds.has('insert') &&
          'underline decoration-[#3d7a52] underline-offset-4',
        kinds.has('delete') &&
          'text-[#9a4f3c] line-through decoration-[#9a4f3c]',
        kinds.has('move') && 'underline decoration-dotted decoration-[#4a6f8a]',
        kinds.has('property') &&
          'underline decoration-dotted decoration-[#8a6a2a]',
      )}
      style={runCss({ ...face, color })}
    >
      {caret ? <PresenceCaret userId={caret.userId} /> : null}
      {text}
      {notes.map((note) => (
        <sup
          key={`${note.kind}-${note.noteId}-${note.runId}`}
          className="text-[0.75em] leading-none"
        >
          {note.mark}
        </sup>
      ))}
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

function runEndNotes(
  run: { id: string; text: string; preservedXmlFragments: string[] },
  visible: string,
  drafts?: Record<string, string>,
) {
  const full = drafts?.[run.id] ?? run.text
  if (full.length > 0 && !full.endsWith(visible)) return []
  return runNoteRefs(run.preservedXmlFragments.join(''), run.id)
}
