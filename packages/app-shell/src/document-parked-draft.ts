import type { DocumentModelWire } from '@obiter/contracts'
import type { DraftState } from './document-draft-state'
import { editableParagraphs, paragraphPlainText } from './document-model-text'
import { insertPlainText, type LocalInsert } from './document-story-flow'

export type ParkedEditStatus = 'appliable' | 'changed'

export type ParkedApply =
  | { kind: 'run-text'; runId: string; text: string }
  | { kind: 'delete'; paragraphId: string }
  | { kind: 'insert'; insert: LocalInsert }

export type ParkedEdit = {
  key: string
  paragraphId: string
  paragraphLabel: string
  kind: 'text' | 'delete' | 'insert'
  oldText: string
  newText: string
  status: ParkedEditStatus
  apply?: ParkedApply
}

export type ParkedDraftReview = {
  edits: ParkedEdit[]
  otherCount: number
  appliableCount: number
  changedCount: number
}

const LABEL_LIMIT = 60

function labelOf(text: string) {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT)}…` : flat
}

function paragraphIndex(model: DocumentModelWire | undefined) {
  const paragraphs = new Map<
    string,
    { text: string; runTexts: Map<string, string> }
  >()
  if (!model) return paragraphs
  for (const paragraph of editableParagraphs(model)) {
    paragraphs.set(paragraph.id, {
      text: paragraphPlainText(paragraph),
      runTexts: new Map(paragraph.runs.map((run) => [run.id, run.text])),
    })
  }
  return paragraphs
}

function otherChangeCount(state: DraftState, held: number) {
  return (
    held +
    Object.keys(state.extraRuns).length +
    state.format.emphasis.length +
    Object.keys(state.format.paragraphStyles).length +
    Object.keys(state.format.numbering).length +
    Object.keys(state.format.paragraphFormats).length +
    Object.keys(state.format.section).length +
    state.breaks.length +
    state.structures.length +
    state.trackedRejections.length
  )
}

export function reviewParkedDraftEdits(
  baseModel: DocumentModelWire | undefined,
  currentModel: DocumentModelWire | undefined,
  state: DraftState,
  heldCount: number,
  current: DraftState,
): ParkedDraftReview {
  const base = paragraphIndex(baseModel)
  const now = paragraphIndex(currentModel)
  const edits: ParkedEdit[] = []

  for (const [runId, text] of Object.entries(state.drafts)) {
    const baseEntry = [...base.entries()].find(([, entry]) =>
      entry.runTexts.has(runId),
    )
    const paragraphId = baseEntry?.[0] ?? ''
    const oldText = baseEntry?.[1].runTexts.get(runId) ?? ''
    const currentEntry = now.get(paragraphId)
    const currentRunText = currentEntry?.runTexts.get(runId)
    const appliable =
      paragraphId !== '' &&
      currentRunText === oldText &&
      current.drafts[runId] === undefined &&
      !current.deletedParagraphIds.includes(paragraphId)
    edits.push({
      key: `run:${runId}`,
      paragraphId,
      paragraphLabel: labelOf(baseEntry?.[1].text ?? ''),
      kind: 'text',
      oldText,
      newText: text,
      status: appliable ? 'appliable' : 'changed',
      ...(appliable
        ? { apply: { kind: 'run-text' as const, runId, text } }
        : {}),
    })
  }

  for (const paragraphId of state.deletedParagraphIds) {
    const baseEntry = base.get(paragraphId)
    const nowEntry = now.get(paragraphId)
    const appliable =
      baseEntry !== undefined &&
      nowEntry !== undefined &&
      nowEntry.text === baseEntry.text &&
      !current.deletedParagraphIds.includes(paragraphId)
    edits.push({
      key: `delete:${paragraphId}`,
      paragraphId,
      paragraphLabel: labelOf(baseEntry?.text ?? ''),
      kind: 'delete',
      oldText: baseEntry?.text ?? '',
      newText: '(paragraph deleted)',
      status: appliable ? 'appliable' : 'changed',
      ...(appliable ? { apply: { kind: 'delete' as const, paragraphId } } : {}),
    })
  }

  for (const insert of state.inserts) {
    const anchor = base.get(insert.afterParagraphId)
    const appliable =
      anchor !== undefined &&
      !current.deletedParagraphIds.includes(insert.afterParagraphId) &&
      (now.has(insert.afterParagraphId) ||
        current.inserts.some(
          (item) => item.clientId === insert.afterParagraphId,
        ))
    edits.push({
      key: `insert:${insert.clientId}`,
      paragraphId: insert.afterParagraphId,
      paragraphLabel: labelOf(anchor?.text ?? ''),
      kind: 'insert',
      oldText: '',
      newText: insertPlainText(insert),
      status: appliable ? 'appliable' : 'changed',
      ...(appliable ? { apply: { kind: 'insert' as const, insert } } : {}),
    })
  }

  const appliableCount = edits.filter(
    (edit) => edit.status === 'appliable',
  ).length
  return {
    edits,
    otherCount: otherChangeCount(state, heldCount),
    appliableCount,
    changedCount: edits.length - appliableCount,
  }
}

export function appliableParkedEdits(edits: readonly ParkedEdit[]) {
  const drafts: Record<string, string> = {}
  const deletedParagraphIds: string[] = []
  const inserts: LocalInsert[] = []
  for (const edit of edits) {
    if (edit.status !== 'appliable' || !edit.apply) continue
    if (edit.apply.kind === 'run-text')
      drafts[edit.apply.runId] = edit.apply.text
    else if (edit.apply.kind === 'delete')
      deletedParagraphIds.push(edit.apply.paragraphId)
    else inserts.push(edit.apply.insert)
  }
  return { drafts, deletedParagraphIds, inserts }
}

export function parkedDraftClipboardText(review: ParkedDraftReview) {
  const parts = review.edits.map((edit) => {
    const label = edit.paragraphLabel || edit.paragraphId || 'Paragraph'
    if (edit.kind === 'insert') {
      return `Insert after “${label}”\nNew text: ${edit.newText}`
    }
    if (edit.kind === 'delete') {
      return `Delete in “${label}”\nWas: ${edit.oldText}`
    }
    const status = edit.status === 'changed' ? ' (Changed by someone else)' : ''
    return `Edit in “${label}”${status}\nBefore: ${edit.oldText}\nAfter: ${edit.newText}`
  })
  if (review.otherCount > 0) {
    parts.push(
      `${String(review.otherCount)} other parked change(s) (formatting or structure) are not listed here.`,
    )
  }
  return parts.join('\n\n')
}
