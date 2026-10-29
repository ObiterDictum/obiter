import type { MouseEvent } from 'react'
import type { DocumentStoryWire } from '@obiter/contracts'
import type { LocalInsert } from '../../document-edits'
import type { ExtraRuns } from '../../document-word-edits'
import {
  blockEndOffset,
  bodyParagraphCaret,
  paragraphClickCaret,
  pageClickCaret,
} from './model-click-caret'
import {
  clearVerticalColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'

export type ModelPageHandlers = {
  onMouseDown: (event: MouseEvent<HTMLElement>) => void
  onClick: (event: MouseEvent<HTMLElement>) => void
}

export function pageClickHandlers(input: {
  editing?: boolean
  marginEditing?: DocumentStoryWire
  story?: DocumentStoryWire
  drafts?: Record<string, string>
  inserts?: LocalInsert[]
  extraRuns?: ExtraRuns
  editableIds: ReadonlySet<string>
  storyOf: (paragraphId: string) => { kind: string; partName: string }
  verticalCaret?: VerticalCaretColumn
  onOpenNoteEditing?: (paragraphId: string) => void
  onExitMarginEditing?: () => void
  onSelectParagraph: (paragraphId: string, offset?: number) => void
}): ModelPageHandlers {
  const {
    editing,
    marginEditing,
    story,
    drafts,
    inserts,
    extraRuns,
    editableIds,
    storyOf,
    verticalCaret,
    onOpenNoteEditing,
    onExitMarginEditing,
    onSelectParagraph,
  } = input

  return {
    onMouseDown: (event) => {
      event.currentTarget.dataset.pointerDown = `${event.clientX},${event.clientY}`
    },
    onClick: (event) => {
      if (!editing) return
      if (!(event.target instanceof Element)) return
      const down = event.currentTarget.dataset.pointerDown
      delete event.currentTarget.dataset.pointerDown
      if (down && down !== `${event.clientX},${event.clientY}`) return
      const endOffset = (id: string) =>
        blockEndOffset(
          id,
          (marginEditing ?? story)?.paragraphs ?? [],
          drafts,
          inserts ?? [],
          extraRuns ?? {},
        )
      const include = (id: string) => editableIds.has(id)
      const paragraphEl = event.target.closest('[data-paragraph-id]')
      if (paragraphEl instanceof HTMLElement) {
        const paragraphId = paragraphEl.dataset.paragraphId
        if (
          paragraphId &&
          storyOf(paragraphId).kind === 'footnotes' &&
          marginEditing?.kind !== 'footnotes'
        ) {
          clearVerticalColumn(verticalCaret)
          onOpenNoteEditing?.(paragraphId)
          return
        }
        if (marginEditing && paragraphId && !include(paragraphId)) {
          const hit = bodyParagraphCaret(
            paragraphEl,
            event.clientX,
            event.clientY,
            event.currentTarget,
            story?.paragraphs ?? [],
            drafts,
            inserts ?? [],
            extraRuns ?? {},
          )
          if (hit) {
            clearVerticalColumn(verticalCaret)
            onExitMarginEditing?.()
            onSelectParagraph(hit.paragraphId, hit.offset)
          }
          return
        }
        const caret = paragraphClickCaret(
          paragraphEl,
          event.clientX,
          event.clientY,
          event.currentTarget,
          endOffset,
          include,
        )
        if (caret && include(caret.paragraphId)) {
          clearVerticalColumn(verticalCaret)
          onSelectParagraph(caret.paragraphId, caret.offset)
          return
        }
      }
      const caret = pageClickCaret(
        event.currentTarget,
        event.clientY,
        endOffset,
        include,
      )
      if (caret) {
        clearVerticalColumn(verticalCaret)
        onSelectParagraph(caret.paragraphId, caret.offset)
      }
    },
  }
}
