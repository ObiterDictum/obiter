import type { DocumentParagraphWire } from '@obiter/contracts'
import { insertPlainText, type LocalInsert } from '../../document-edits'
import {
  effectiveParagraph,
  paragraphPlainText,
} from '../../document-model-text'
import type { ExtraRuns } from '../../document-word-edits'

export function caretFromPoint(
  clientX: number,
  clientY: number,
): { node: Node; offset: number } | undefined {
  // SAFETY: lib.dom lacks the vendor caretPositionFromPoint/caretRangeFromPoint APIs; each is existence-checked before use, so an absent method is skipped rather than called.
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY)
    if (pos) return { node: pos.offsetNode, offset: pos.offset }
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(clientX, clientY)
    if (range) return { node: range.startContainer, offset: range.startOffset }
  }
  return undefined
}

export function paragraphClickCaret(
  paragraphEl: HTMLElement,
  clientX: number,
  clientY: number,
  root: HTMLElement,
  endOffset: (paragraphId: string) => number,
  include?: (paragraphId: string) => boolean,
): { paragraphId: string; offset: number } | undefined {
  const paragraphId = paragraphEl.dataset.paragraphId
  if (!paragraphId) return undefined
  const textRoot =
    paragraphEl.querySelector('[data-paragraph-text]') ?? paragraphEl
  const point = caretFromPoint(clientX, clientY)
  if (!point || !textRoot.contains(point.node)) {
    return pageClickCaret(root, clientY, endOffset, include)
  }
  const range = document.createRange()
  range.selectNodeContents(textRoot)
  range.setEnd(point.node, point.offset)
  const sliceFrom = Number(paragraphEl.dataset.paragraphFrom ?? '0')
  const max = endOffset(paragraphId)
  const offset = Math.min(Math.max(0, sliceFrom + range.toString().length), max)
  return { paragraphId, offset }
}

export function pageClickCaret(
  root: HTMLElement,
  clientY: number,
  endOffset: (paragraphId: string) => number,
  include?: (paragraphId: string) => boolean,
): { paragraphId: string; offset: number } | undefined {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-paragraph-id]')]
  let best: { paragraphId: string; offset: number; dist: number } | undefined
  for (const node of nodes) {
    const paragraphId = node.dataset.paragraphId
    if (!paragraphId || (include && !include(paragraphId))) continue
    const box = node.getBoundingClientRect()
    const dist =
      clientY < box.top
        ? box.top - clientY
        : clientY > box.bottom
          ? clientY - box.bottom
          : 0
    const offset =
      clientY < box.top + box.height / 2 ? 0 : endOffset(paragraphId)
    if (!best || dist < best.dist) best = { paragraphId, offset, dist }
  }
  return best
}

/**
 * A body-paragraph hit while a margin story is open: the click exits margin
 * editing and lands as a body caret, the way Word leaves header editing.
 * Returns null when the clicked element is not a body paragraph.
 */
export function bodyParagraphCaret(
  paragraphEl: HTMLElement,
  clientX: number,
  clientY: number,
  root: HTMLElement,
  bodyParagraphs: DocumentParagraphWire[],
  drafts: Record<string, string> | undefined,
  inserts: LocalInsert[],
  extraRuns: ExtraRuns = {},
): { paragraphId: string; offset: number } | undefined {
  const paragraphId = paragraphEl.dataset.paragraphId
  if (!paragraphId || !bodyParagraphs.some((p) => p.id === paragraphId)) {
    return undefined
  }
  const ids = new Set(bodyParagraphs.map((p) => p.id))
  const end = (id: string) =>
    blockEndOffset(id, bodyParagraphs, drafts, inserts, extraRuns)
  const caret = paragraphClickCaret(
    paragraphEl,
    clientX,
    clientY,
    root,
    end,
    (id) => ids.has(id),
  )
  return { paragraphId, offset: caret?.offset ?? 0 }
}

export function blockEndOffset(
  paragraphId: string,
  paragraphs: DocumentParagraphWire[],
  drafts: Record<string, string> | undefined,
  inserts: LocalInsert[],
  extraRuns: ExtraRuns = {},
): number {
  const insert = inserts.find((item) => item.clientId === paragraphId)
  if (insert) return insertPlainText(insert).length
  const paragraph = paragraphs.find((item) => item.id === paragraphId)
  if (!paragraph) return 0
  return paragraphPlainText(
    effectiveParagraph(paragraph, drafts, extraRuns[paragraphId] ?? []),
  ).length
}
