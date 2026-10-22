import type {
  DocumentChangeWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphPlainText, textDiff } from './document-model-text'

export type InlineSpan = {
  from: number
  to: number
  offset: number
  change: DocumentChangeWire
}

/** Display-only projection. Neither virtual runs nor tracked text enter drafts. */
export function inlineChanges(
  paragraph: DocumentParagraphWire,
  changes: readonly DocumentChangeWire[],
  partName?: string,
) {
  const relevant = changes.filter(
    (change) =>
      change.paragraphId === paragraph.id &&
      (!partName || change.storyPartName === partName) &&
      change.inlinePosition &&
      change.kind !== 'property',
  )
  const runs: DocumentParagraphWire['runs'] = []
  const spans: InlineSpan[] = []
  let offset = 0
  let displayOffset = 0
  function append(beforeRunId: string | null) {
    for (const change of relevant) {
      if (change.inlinePosition?.beforeRunId !== beforeRunId) continue
      runs.push({ id: change.id, text: change.text, preservedXmlFragments: [] })
      spans.push({
        from: displayOffset,
        to: displayOffset + change.text.length,
        offset,
        change,
      })
      displayOffset += change.text.length
    }
  }
  for (const run of paragraph.runs) {
    append(run.id)
    runs.push(run)
    offset += run.text.length
    displayOffset += run.text.length
  }
  append(null)
  const projected = { ...paragraph, runs }
  const text = paragraphPlainText(projected)
  const editableText = paragraphPlainText(paragraph)
  const toEditable = (at: number) => {
    let removed = 0
    for (const span of spans)
      removed += Math.max(0, Math.min(at, span.to) - span.from)
    return at - removed
  }
  const toDisplay = (at: number, side: 'before' | 'after' = 'after') => {
    let added = 0
    for (const span of spans) {
      if (span.offset < at || (span.offset === at && side === 'after'))
        added += span.to - span.from
    }
    return at + added
  }
  return {
    paragraph: projected,
    text,
    editableText,
    spans,
    toEditable,
    toDisplay,
  }
}
export type InlineProjection = ReturnType<typeof inlineChanges>

export function inlineSlice(
  projection: InlineProjection,
  from: number,
  to: number,
) {
  const start = projection.toEditable(from)
  const end = projection.toEditable(to)
  const text = projection.text.slice(from, to)
  const editableText = projection.editableText.slice(start, end)
  const toEditable = (at: number) => projection.toEditable(from + at) - start
  const toDisplay = (at: number) =>
    Math.max(0, Math.min(to - from, projection.toDisplay(start + at) - from))
  return {
    text,
    editableText,
    toEditable,
    toDisplay,
    edit(next: string) {
      const diff = textDiff(text, next)
      return (
        editableText.slice(0, toEditable(diff.from)) +
        diff.insert +
        editableText.slice(toEditable(diff.to))
      )
    },
  }
}
export type InlineSlice = ReturnType<typeof inlineSlice>
