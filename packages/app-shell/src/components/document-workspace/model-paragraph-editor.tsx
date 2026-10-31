import type { ComponentProps, CSSProperties } from 'react'
import type { DocumentParagraphWire } from '@obiter/contracts'
import type { ParagraphFace } from '../../document-page-style'
import { deleteCharBeforeOffset, textDiff } from '../../document-model-text'
import type { ModelParagraph } from './model-paragraph-memo'
import { ParagraphEditor } from './paragraph-editor'

export type ParagraphWordEdit = {
  type: 'replace' | 'deleteBackward' | 'deleteForward' | 'split' | 'lineBreak'
  paragraphId: string
  offset: number
  from?: number
  to?: number
  insert?: string
}

export function ModelParagraphEditor({
  paragraph,
  projection,
  trackedDescription,
  effective,
  fullText,
  start,
  end,
  sliceText,
  face,
  faceCss,
  onBodyEdge,
  editorHeight,
  linePx,
  selected,
  restoreCaret,
  lines,
  previous,
  next,
  verticalCaret,
  selection,
  onFocusParagraph,
  onMoveCaret,
  onTextSelection,
  onSelect,
  onWordEdit,
  onRunTextChange,
  onJoinPrevious,
  onDeleteParagraph,
  onInsertParagraph,
}: Pick<
  ComponentProps<typeof ParagraphEditor>,
  | 'projection'
  | 'trackedDescription'
  | 'selected'
  | 'restoreCaret'
  | 'lines'
  | 'previous'
  | 'next'
  | 'verticalCaret'
  | 'selection'
  | 'onFocusParagraph'
  | 'onMoveCaret'
  | 'onTextSelection'
  | 'onSelect'
> &
  Pick<
    ComponentProps<typeof ModelParagraph>,
    | 'onWordEdit'
    | 'onRunTextChange'
    | 'onJoinPrevious'
    | 'onDeleteParagraph'
    | 'onInsertParagraph'
  > & {
    paragraph: DocumentParagraphWire
    effective: DocumentParagraphWire
    fullText: string
    start: number
    end: number
    sliceText: string
    face: ParagraphFace
    faceCss: CSSProperties
    onBodyEdge: boolean
    editorHeight: number
    linePx: number
  }) {
  return (
    <ParagraphEditor
      paragraphId={paragraph.id}
      text={sliceText}
      projection={projection}
      trackedDescription={trackedDescription}
      selected={selected}
      restoreCaret={restoreCaret}
      lines={lines}
      previous={previous}
      next={next}
      verticalCaret={verticalCaret}
      selection={selection}
      onFocusParagraph={onFocusParagraph}
      onMoveCaret={onMoveCaret}
      onTextSelection={onTextSelection}
      style={{
        ...faceCss,
        marginTop: 0,
        marginBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        textIndent: onBodyEdge ? 0 : faceCss.textIndent,
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
        const first = effective.runs[0]
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
          const next = deleteCharBeforeOffset(effective, undefined, offset)
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
          const next = deleteCharBeforeOffset(effective, undefined, offset + 1)
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
  )
}
