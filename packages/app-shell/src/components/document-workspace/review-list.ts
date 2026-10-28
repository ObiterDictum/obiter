import type {
  DocumentComment,
  DocumentImportedCommentThread,
  DocumentModelWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from '../../document-model-text'
import { itemLead, reviewItems, type ReviewItem } from './review-items'

/** One row of the merged review list: a tracked change, a move, or a thread. */
export type ReviewRow =
  | {
      kind: 'change'
      id: string
      item: ReviewItem
      /** Where it is: "Clause 4.2", or the paragraph's first words. */
      location: string
      /** One line of the paragraph around the change. */
      context: string
      order: number
    }
  | {
      kind: 'comment'
      id: string
      comment: DocumentComment | DocumentImportedCommentThread
      imported: boolean
      location: string
      context: string
      order: number
    }

export type ReviewFilter = 'all' | 'change' | 'comment' | 'move'

const WORDS = 6

/**
 * The review list, in document order: changes and moves with the comment
 * threads interleaved, so a reader works through the document once rather
 * than cross-referencing two panels. A row with no locatable paragraph sorts
 * last rather than being dropped.
 */
export function reviewRows({
  model,
  changes,
  comments,
  importedComments,
  drafts,
}: {
  model: DocumentModelWire | undefined
  changes: Parameters<typeof reviewItems>[0]
  comments: readonly DocumentComment[]
  importedComments: readonly DocumentImportedCommentThread[]
  drafts?: Record<string, string>
}): ReviewRow[] {
  const story = model ? documentStory(model) : undefined
  const paragraphs = story?.paragraphs ?? []
  const indexOf = new Map(paragraphs.map((item, index) => [item.id, index]))
  const textOf = (paragraphId: string | undefined) => {
    if (!paragraphId) return ''
    const paragraph = paragraphs.find((item) => item.id === paragraphId)
    if (!paragraph) return ''
    return paragraphPlainText(paragraph, drafts)
  }
  const orderOf = (paragraphId: string | undefined, offset: number) => {
    const index = paragraphId ? indexOf.get(paragraphId) : undefined
    return index === undefined ? Number.MAX_SAFE_INTEGER : index * 10_000 + offset
  }
  const rows: ReviewRow[] = []
  for (const item of reviewItems(changes)) {
    const lead = itemLead(item)
    rows.push({
      kind: 'change',
      id: item.id,
      item,
      location: paragraphLocation(paragraphs, indexOf, lead.paragraphId),
      context: surroundingText(
        textOf(lead.paragraphId),
        lead.text || undefined,
      ),
      order: orderOf(lead.paragraphId, rows.length),
    })
  }
  for (const comment of comments) {
    const paragraphId = comment.anchor.paragraphId
    rows.push({
      kind: 'comment',
      id: comment.id,
      comment,
      imported: false,
      location: paragraphLocation(paragraphs, indexOf, paragraphId),
      context: surroundingText(textOf(paragraphId), undefined, 0, 90),
      order: orderOf(paragraphId, comment.anchor.startOffset),
    })
  }
  for (const comment of importedComments) {
    const paragraphId = comment.anchor?.paragraphId
    rows.push({
      kind: 'comment',
      id: comment.id,
      comment,
      imported: true,
      location: paragraphLocation(paragraphs, indexOf, paragraphId),
      context: surroundingText(textOf(paragraphId), undefined, 0, 90),
      order: orderOf(paragraphId, comment.anchor?.startOffset ?? 0),
    })
  }
  return rows.sort((left, right) => left.order - right.order)
}

/** Whether a row survives the filter tabs. */
export function rowMatchesFilter(row: ReviewRow, filter: ReviewFilter) {
  if (filter === 'all') return true
  if (filter === 'comment') return row.kind === 'comment'
  if (row.kind === 'comment') return false
  return filter === 'move' ? row.item.kind === 'move' : row.item.kind === 'change'
}

/**
 * Where a change sits: the nearest numbered clause above it, else the
 * paragraph's own opening words. Never a guess at a clause number the
 * document does not print.
 */
export function paragraphLocation(
  paragraphs: ReadonlyArray<{ id: string; runs?: ReadonlyArray<{ text: string }> }>,
  indexOf: ReadonlyMap<string, number>,
  paragraphId: string | undefined,
  drafts?: Record<string, string>,
): string {
  if (!paragraphId) return 'No location'
  const index = indexOf.get(paragraphId)
  if (index === undefined) return 'No location'
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const paragraph = paragraphs[cursor]
    if (!paragraph) continue
    const text =
      drafts && paragraph.runs
        ? paragraph.runs.map((run) => run.text).join('')
        : paragraphText(paragraph)
    const number = leadingNumber(text)
    if (number) return `Clause ${number}`
  }
  const first = firstWords(paragraphText(paragraphs[index]!), WORDS)
  return first === '' ? 'Empty paragraph' : `“${first}”`
}

function paragraphText(paragraph: { runs?: ReadonlyArray<{ text: string }> }) {
  return (paragraph.runs ?? []).map((run) => run.text).join('')
}

/** A clause number at the start of a paragraph: "4", "4.2", "12.3.1". */
export function leadingNumber(text: string) {
  const match = /^\s*((?:\d+\.)*\d+)\.?(?:\s|$)/u.exec(text)
  return match?.[1]
}

function firstWords(text: string, count: number) {
  const words = text.trim().split(/\s+/u).filter((word) => word !== '')
  return words.slice(0, count).join(' ')
}

/** The paragraph's own words around the change, on one line. */
export function surroundingText(
  text: string,
  needle: string | undefined,
  before = 24,
  after = 60,
) {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const at = needle ? trimmed.indexOf(needle) : -1
  if (at < 0) return clip(trimmed, after)
  const start = Math.max(0, at - before)
  const end = Math.min(trimmed.length, at + needle!.length + after)
  return `${start > 0 ? '…' : ''}${trimmed.slice(start, end)}${end < trimmed.length ? '…' : ''}`
}

function clip(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

/** The changed text itself, bounded: a card shows the change, not a page. */
export function changedWords(text: string, limit = 60) {
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}
