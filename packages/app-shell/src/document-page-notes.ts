import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'
import { xmlAttr, xmlTagAttrs } from './document-page-units'

export type NoteKind = 'footnote' | 'endnote'

export type NoteRef = {
  kind: NoteKind
  noteId: string
  mark: string
  runId: string
  custom: boolean
}

export type NoteBody = {
  kind: NoteKind
  noteId: string
  mark: string
  paragraphs: DocumentParagraphWire[]
}

export function runNoteRefs(runXml: string, runId: string): NoteRef[] {
  return [
    ...noteTags(runXml, 'footnoteReference').map((tag) => ({
      kind: 'footnote' as const,
      noteId: tag.noteId,
      mark: noteMark(tag.noteId),
      runId,
      custom: tag.custom,
    })),
    ...noteTags(runXml, 'endnoteReference').map((tag) => ({
      kind: 'endnote' as const,
      noteId: tag.noteId,
      mark: noteMark(tag.noteId),
      runId,
      custom: tag.custom,
    })),
  ]
}

export function noteNumberKey(kind: NoteKind, noteId: string): string {
  return `${kind}:${noteId}`
}

const numbersByModel = new WeakMap<DocumentModelWire, Map<string, string>>()

export function documentNoteNumbers(
  model: DocumentModelWire,
): Map<string, string> {
  const cached = numbersByModel.get(model)
  if (cached) return cached
  const numbers = new Map<string, string>()
  const counters = { footnote: 0, endnote: 0 }
  const story = model.stories.find((item) => item.kind === 'document')
  for (const paragraph of story?.paragraphs ?? []) {
    for (const ref of paragraphNoteRefs(paragraph)) {
      const key = noteNumberKey(ref.kind, ref.noteId)
      if (numbers.has(key)) continue
      if (ref.custom) {
        numbers.set(key, '')
        continue
      }
      counters[ref.kind] += 1
      numbers.set(key, String(counters[ref.kind]))
    }
  }
  numbersByModel.set(model, numbers)
  return numbers
}

export function paragraphNoteRefs(paragraph: DocumentParagraphWire): NoteRef[] {
  return paragraph.runs.flatMap((run) =>
    runNoteRefs(run.preservedXmlFragments.join(''), run.id),
  )
}

const notesByModel = new WeakMap<DocumentModelWire, NoteBody[]>()

export function documentNotes(model: DocumentModelWire): NoteBody[] {
  const cached = notesByModel.get(model)
  if (cached) return cached
  const notes = collectNotes(model)
  notesByModel.set(model, notes)
  return notes
}

function collectNotes(model: DocumentModelWire): NoteBody[] {
  const footnotes = noteStoryBodies(model, 'footnotes', 'footnote')
  const endnotes = noteStoryBodies(model, 'endnotes', 'endnote')
  const used = new Set<string>()
  const ordered: NoteBody[] = []
  const story = model.stories.find((item) => item.kind === 'document')
  if (!story) return [...footnotes.values(), ...endnotes.values()]
  const numbers = documentNoteNumbers(model)
  for (const paragraph of story.paragraphs) {
    for (const ref of paragraphNoteRefs(paragraph)) {
      const key = noteNumberKey(ref.kind, ref.noteId)
      if (used.has(key)) continue
      const body =
        ref.kind === 'footnote'
          ? footnotes.get(ref.noteId)
          : endnotes.get(ref.noteId)
      if (!body) continue
      used.add(key)
      ordered.push({ ...body, mark: numbers.get(key) ?? body.mark })
    }
  }
  return ordered
}

export function noteEntryGroups(story: DocumentStoryWire): string[][] {
  const groups: string[][] = []
  let cursor = 0
  for (const fragment of story.preservedXmlFragments) {
    const count = Math.max(1, (fragment.match(/<w:p\b/giu) ?? []).length)
    groups.push(
      story.paragraphs
        .slice(cursor, cursor + count)
        .map((paragraph) => paragraph.id),
    )
    cursor += count
  }
  return groups
}

function noteStoryBodies(
  model: DocumentModelWire,
  storyKind: 'footnotes' | 'endnotes',
  elementName: 'footnote' | 'endnote',
): Map<string, NoteBody> {
  const story = model.stories.find((item) => item.kind === storyKind)
  const bodies = new Map<string, NoteBody>()
  if (!story) return bodies
  let cursor = 0
  for (const fragment of story.preservedXmlFragments) {
    const noteId = xmlAttr(xmlTagAttrs(fragment, elementName), 'id')
    const count = Math.max(1, (fragment.match(/<w:p\b/gi) ?? []).length)
    const paragraphs = story.paragraphs.slice(cursor, cursor + count)
    cursor += count
    if (!noteId || noteId === '-1' || noteId === '0') continue
    bodies.set(noteId, {
      kind: storyKind === 'footnotes' ? 'footnote' : 'endnote',
      noteId,
      mark: noteMark(noteId),
      paragraphs,
    })
  }
  return bodies
}

function noteTags(xml: string, name: 'footnoteReference' | 'endnoteReference') {
  const tags = xml.matchAll(new RegExp(`<w:${name}\\b([^>]*)\\/?>`, 'gi'))
  const found: { noteId: string; custom: boolean }[] = []
  for (const tag of tags) {
    const noteId = xmlAttr(tag[1], 'id')
    const custom = xmlAttr(tag[1], 'customMarkFollows')
    if (noteId && noteId !== '-1' && noteId !== '0')
      found.push({
        noteId,
        custom: custom !== undefined && !['0', 'false', 'off'].includes(custom),
      })
  }
  return found
}

function noteMark(noteId: string): string {
  return /^\d+$/.test(noteId) ? noteId : '*'
}
