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
  sliceContainsOffset,
  textDiff,
} from '../../document-model-text'
import { paragraphInlineXml } from '../../document-page-floats'
import { wrapLines } from '../../document-page-flow'
import type { ListMarker } from '../../document-page-lists'
import { imagePartNameForDrawing } from '../../document-page-media'
import type { NoteKind } from '../../document-page-notes'
import {
  paragraphCss,
  paragraphFace,
  paragraphLineHeightPx,
} from '../../document-page-style'
import type { SelectionEndpoint } from '../../document-selection'
import { PageDrawing } from './page-drawing'
import type { ArrowNeighbor, VerticalCaretColumn } from './paragraph-arrow'
import type {
  ParagraphSelectionBinding,
  ParagraphSelectionHandlers,
} from './paragraph-editor'
import { ParagraphEditor } from './paragraph-editor'
import { ParagraphRunPaint, type ParagraphSelectionRange } from './model-run'

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
  onMoveCaret,
  onTextSelection,
  restoreCaret,
  previous,
  next,
  verticalCaret,
  selectionHandlers,
  selectionSegment,
  editing,
  onFocusParagraph,
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
  story,
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
  onMoveCaret?: (paragraphId: string, offset: number) => void
  onTextSelection?: (
    paragraphId: string,
    from: number,
    to: number,
    direction: 'forward' | 'backward',
  ) => void
  restoreCaret?: { paragraphId: string; offset: number } | null
  previous?: ArrowNeighbor
  next?: ArrowNeighbor
  verticalCaret?: VerticalCaretColumn
  selectionHandlers?: ParagraphSelectionHandlers
  selectionSegment?: ParagraphSelectionRange | null
  onFocusParagraph?: () => void
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
  /** The story this paragraph belongs to as rendered. Paragraph ids are only
   * unique inside their story, so verification anchoring needs the story on the
   * element, not only the paragraph. */
  story?: { kind: string; partName: string }
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
  const sliceText = fullText.slice(start, end)
  const linePx = paragraphLineHeightPx(face)
  const images = continuation ? [] : paragraphInlineXml(paragraph)
  // A block that places the paragraph's final row reaches the end of the text;
  // a block that stops at a hard break ends one code unit before it. The caret
  // at that break's offset still renders at the end of this block's last row,
  // so this block owns it rather than the fragment that resumes after it.
  const ownsBreak = end < fullText.length && fullText[end] === '\n'
  const restore =
    restoreCaret?.paragraphId === paragraph.id &&
    (sliceContainsOffset(restoreCaret.offset, start, end, fullText.length) ||
      (ownsBreak && restoreCaret.offset === end))
      ? restoreCaret.offset - start
      : undefined
  const lines = wrapLines(
    sliceText,
    face.run.fontSizePx ?? linePx,
    wrapWidthPx && wrapWidthPx > 0 ? wrapWidthPx : Number.POSITIVE_INFINITY,
    face.run.fontFamily,
  )
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
  // The focused editor paints the document selection through the same run
  // overlay the static paint uses, so a selection reads alike in every
  // paragraph. A block only shows the part of the segment that it owns, so the
  // range is clamped to this block: the paint reads it in paragraph-model
  // offsets and the editor in block-local ones.
  const paintSelection: ParagraphSelectionRange | undefined = selectionSegment
    ? {
        from: Math.max(selectionSegment.from, start),
        to: Math.min(selectionSegment.to, end),
      }
    : undefined
  const localSelection: ParagraphSelectionRange | undefined = paintSelection
    ? {
        from: paintSelection.from - start,
        to: paintSelection.to - start,
      }
    : undefined
  const selectionBinding: ParagraphSelectionBinding | undefined =
    selectionHandlers
      ? {
          ...selectionHandlers,
          range: localSelection ?? null,
          // The workspace places the caret at the focus endpoint, so its
          // slice-local offset is the moving end while this paragraph holds
          // the caret. Another paragraph of the same block never does.
          focus:
            selectionHandlers.active &&
            restoreCaret?.paragraphId === paragraph.id
              ? restoreCaret.offset - start
              : null,
          onExtend: (focus, anchor) =>
            selectionHandlers.onExtend(
              toModelEndpoint(focus, paragraph.id, start),
              toModelEndpoint(anchor, paragraph.id, start),
            ),
        }
      : undefined
  const runPaint = (
    <ParagraphRunPaint
      paragraph={paragraph}
      drafts={drafts}
      changes={changes}
      styles={styles}
      face={face}
      start={start}
      end={end}
      lines={lines}
      linePx={linePx}
      wrapWidthPx={wrapWidthPx}
      selection={paintSelection}
      carets={carets}
    />
  )

  return (
    <div
      data-paragraph-id={paragraph.id}
      data-paragraph-from={from ?? 0}
      data-paragraph-to={end}
      data-paragraph-story={story?.kind}
      data-paragraph-part={story?.partName}
      aria-current={selected ? 'true' : undefined}
      aria-label={`Paragraph ${paragraph.id}`}
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
        <div
          className="relative min-h-[1em] min-w-0 flex-1"
          data-paragraph-text
        >
          {editing && holdsCaret ? (
            <>
              <div
                data-caret-run-overlay
                className="pointer-events-none absolute inset-0"
                aria-hidden="true"
              >
                {runPaint}
              </div>
              <ParagraphEditor
                paragraphId={paragraph.id}
                text={sliceText}
                selected={holdsCaret}
                restoreCaret={restore}
                lines={lines}
                previous={previous}
                next={next}
                verticalCaret={verticalCaret}
                selection={selectionBinding}
                onFocusParagraph={onFocusParagraph}
                onMoveCaret={onMoveCaret}
                onTextSelection={(localStart, localEnd, direction) =>
                  onTextSelection?.(
                    paragraph.id,
                    start + localStart,
                    start + localEnd,
                    direction,
                  )
                }
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
                  color: 'transparent',
                  backgroundColor: 'transparent',
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
                    const next = deleteCharBeforeOffset(
                      paragraph,
                      drafts,
                      offset,
                    )
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
            </>
          ) : (
            runPaint
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The editor emits offsets local to the block it renders. A step that stays in
 * this paragraph is therefore base-relative; a step into a neighbour already
 * names a model offset, and the two are told apart by the paragraph id.
 */
function toModelEndpoint(
  endpoint: SelectionEndpoint,
  paragraphId: string,
  base: number,
): SelectionEndpoint {
  return endpoint.paragraphId === paragraphId
    ? { paragraphId, offset: base + endpoint.offset }
    : endpoint
}
