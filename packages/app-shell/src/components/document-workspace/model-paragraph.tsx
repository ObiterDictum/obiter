import { useContext, useMemo } from 'react'
import { inlineChanges, inlineSlice } from '../../document-inline-changes'
import { InlineChangeReview } from './inline-change-review'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
  DocumentPresence,
  DocumentRelationshipWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import { projectRangeEmphasis } from '../../document-format-paint'
import {
  emptyFormatDrafts,
  type PendingEmphasis,
} from '../../document-format-types'
import {
  effectiveParagraph,
  paragraphPlainText,
  sliceContainsOffset,
} from '../../document-model-text'
import { paragraphInlineXml } from '../../document-page-floats'
import { firstLineIndentPx, wrapLines } from '../../document-page-flow'
import type { ListMarker } from '../../document-page-lists'
import { imagePartNameForDrawing } from '../../document-page-media'
import type { NoteKind } from '../../document-page-notes'
import {
  paragraphCss,
  paragraphFace,
  paragraphLineHeightPx,
} from '../../document-page-style'
import { toModelEndpoint } from '../../document-selection'
import { PageDrawing } from './page-drawing'
import type {
  ParagraphNeighborResolver,
  VerticalCaretColumn,
} from './paragraph-arrow'
import type {
  ParagraphSelectionBinding,
  ParagraphSelectionHandlers,
} from './paragraph-editor'
import { ModelParagraphEditor } from './model-paragraph-editor'
import { ParagraphRunPaint, type ParagraphSelectionRange } from './model-run'
import type { ParagraphLinkOverlay } from '../../document-structure-overlays'

export type { ParagraphWordEdit } from './model-paragraph-editor'
import type { ParagraphWordEdit } from './model-paragraph-editor'

export function ModelParagraph({
  paragraph,
  changes,
  selected,
  onSelectParagraph,
  drafts,
  emphasis = emptyFormatDrafts.emphasis,
  onRunTextChange,
  onInsertParagraph,
  onDeleteParagraph,
  onJoinPrevious,
  onWordEdit,
  onMoveCaret,
  onTextSelection,
  restoreCaret,
  neighbors,
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
  pageNumber = 1,
  pageReferences,
  listMarker,
  noteMark,
  noteKind,
  story,
  linkOverlay,
}: {
  paragraph: DocumentParagraphWire
  changes: DocumentChangeWire[]
  selected: boolean
  onSelectParagraph: (paragraphId: string, offset?: number) => void
  drafts?: Record<string, string>
  /**
   * Pending range emphasis, in effective-text offsets. Applied after the
   * text draft so a slice cannot be replaced by the whole draft.
   */
  emphasis?: readonly PendingEmphasis[]
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
  neighbors?: ParagraphNeighborResolver
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
  /** The page this block paints on: resolves `PAGE` fields in stored runs. */
  pageNumber?: number
  /** Bookmark name → laid-out page: resolves `PAGEREF` field instructions. */
  pageReferences?: ReadonlyMap<string, number>
  listMarker?: ListMarker
  noteMark?: string
  noteKind?: NoteKind
  /** The story this paragraph belongs to as rendered. Paragraph ids are only
   * unique inside their story, so verification anchoring needs the story on the
   * element, not only the paragraph. */
  story?: { kind: string; partName: string }
  linkOverlay?: ParagraphLinkOverlay
}) {
  const carets = (presence ?? []).filter(
    (item) =>
      item.userId !== currentUserId &&
      item.cursor?.paragraphId === paragraph.id,
  )
  const face = useMemo(
    // `paragraphFace` reads only the paragraph's style id and its own XML, and
    // both keep their identity when only the paragraph's text changes. Keying
    // on those rather than the rebuilt paragraph object means an untouched
    // paragraph does not re-parse its formatting on every keystroke.
    () => paragraphFace(paragraph, styles),
    [paragraph.preservedXmlFragments, paragraph.styleId, styles],
  )
  const effective = effectiveParagraph(paragraph, drafts)
  const formatted = projectRangeEmphasis(effective, emphasis)
  const projection = inlineChanges(formatted, changes, storyPartName)
  const review = useContext(InlineChangeReview)
  const fullText = paragraphPlainText(effective)
  const displayStart = from ?? 0
  const displayEnd = to ?? projection.text.length
  const start = projection.toEditable(displayStart)
  const end = projection.toEditable(displayEnd)
  const sliceText = fullText.slice(start, end)
  const displayText = projection.text.slice(displayStart, displayEnd)
  const mapped = projection.spans.length
    ? inlineSlice(projection, displayStart, displayEnd)
    : undefined
  const linePx = paragraphLineHeightPx(face)
  const images = continuation ? [] : paragraphInlineXml(paragraph)
  // A block that places the paragraph's final row reaches the end of the text;
  // a block that stops at a hard break ends one code unit before it. The caret
  // at that break's offset still renders at the end of this block's last row,
  // so this block owns it rather than the fragment that resumes after it.
  const ownsBreak = end < fullText.length && fullText[end] === '\n'
  const restore =
    restoreCaret?.paragraphId === paragraph.id &&
    (sliceContainsOffset(
      projection.toDisplay(restoreCaret.offset),
      displayStart,
      displayEnd,
      projection.text.length,
    ) ||
      (ownsBreak && restoreCaret.offset === end))
      ? restoreCaret.offset - start
      : undefined
  // Wrapping measures every line through the canvas. An unchanged paragraph's
  // slice text is an equal string, so the measurement survives the keystroke
  // even though the paragraph object was rebuilt.
  const faceCss = paragraphCss(face)
  const onBodyEdge = continuation || start > 0 || Boolean(listMarker)
  const lines = useMemo(
    () =>
      wrapLines(
        displayText,
        face.run.fontSizePx ?? linePx,
        wrapWidthPx && wrapWidthPx > 0 ? wrapWidthPx : Number.POSITIVE_INFINITY,
        face.run.fontFamily,
        firstLineIndentPx(face, onBodyEdge),
      ),
    [displayText, face, linePx, wrapWidthPx, onBodyEdge],
  )
  const editorHeight = lines.length * linePx
  const holdsCaret =
    Boolean(editing) &&
    selected &&
    (restore !== undefined ||
      restoreCaret == null ||
      restoreCaret.paragraphId !== paragraph.id)
  // Only the paragraph holding the caret reads a neighbour, and the resolver
  // only then wraps the neighbour's text. Everything else pays a lookup.
  const adjacent =
    editing && holdsCaret && neighbors
      ? neighbors(paragraph.id, wrapWidthPx, drafts)
      : undefined
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
          onPasteText: selectionHandlers.onPasteText
            ? (text, from, to) =>
                selectionHandlers.onPasteText?.(
                  paragraph.id,
                  text,
                  start + from,
                  start + to,
                )
            : undefined,
        }
      : undefined
  const runPaint = (
    <ParagraphRunPaint
      paragraph={projection.paragraph}
      toEditableOffset={projection.toEditable}
      drafts={drafts}
      changes={changes}
      styles={styles}
      face={face}
      start={displayStart}
      end={displayEnd}
      lines={lines}
      linePx={linePx}
      wrapWidthPx={wrapWidthPx}
      selection={
        paintSelection
          ? {
              from: projection.toDisplay(paintSelection.from, 'after'),
              to: projection.toDisplay(paintSelection.to, 'before'),
            }
          : undefined
      }
      linkOverlay={
        linkOverlay
          ? {
              links: linkOverlay.links.map((link) => ({
                ...link,
                from: projection.toDisplay(link.from, 'after'),
                to: projection.toDisplay(link.to, 'before'),
              })),
              marks: linkOverlay.marks.map((mark) => ({
                from: projection.toDisplay(mark.from, 'after'),
                to: projection.toDisplay(mark.to, 'before'),
              })),
              fieldMarkers: linkOverlay.fieldMarkers.map((marker) => ({
                ...marker,
                offset: projection.toDisplay(marker.offset),
              })),
            }
          : undefined
      }
      carets={carets}
      continuation={continuation}
      pageNumber={pageNumber}
      pageReferences={pageReferences}
    />
  )

  return (
    <div
      data-paragraph-id={paragraph.id}
      data-paragraph-from={start}
      data-paragraph-to={end}
      data-paragraph-story={story?.kind}
      data-paragraph-part={story?.partName}
      onClickCapture={(event) => {
        if (!review || !(event.target instanceof HTMLTextAreaElement)) return
        const at = displayStart + event.target.selectionStart
        const span = projection.spans.find(
          (item) => at >= item.from && at < item.to,
        )
        if (!span) return
        event.stopPropagation()
        review.selectChange(span.change.id)
      }}
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
        ...faceCss,
        ...(listMarker ? { textIndent: 0 } : {}),
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
              <ModelParagraphEditor
                paragraph={paragraph}
                projection={mapped}
                effective={effective}
                fullText={fullText}
                start={start}
                end={end}
                sliceText={sliceText}
                face={face}
                faceCss={faceCss}
                onBodyEdge={onBodyEdge}
                editorHeight={editorHeight}
                linePx={linePx}
                selected={holdsCaret}
                restoreCaret={restore}
                lines={
                  mapped
                    ? lines
                        .map((line) => ({
                          text: sliceText.slice(
                            mapped.toEditable(line.from),
                            mapped.toEditable(line.to),
                          ),
                          from: mapped.toEditable(line.from),
                          to: mapped.toEditable(line.to),
                        }))
                        .filter(
                          (line, index, all) =>
                            line.to > line.from ||
                            (index === all.length - 1 &&
                              line.to === sliceText.length),
                        )
                    : lines
                }
                previous={adjacent?.previous}
                next={adjacent?.next}
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
                onSelect={(local) =>
                  local == null
                    ? onSelectParagraph(paragraph.id)
                    : onSelectParagraph(paragraph.id, start + local)
                }
                onWordEdit={onWordEdit}
                onRunTextChange={onRunTextChange}
                onJoinPrevious={onJoinPrevious}
                onDeleteParagraph={onDeleteParagraph}
                onInsertParagraph={onInsertParagraph}
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
