import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { xmlAttr, xmlTagAttrs } from './document-page-units'

export type NoteKind = 'footnote' | 'endnote'

export type NoteRef = {
  kind: NoteKind
  noteId: string
  mark: string
  runId: string
}

export type NoteBody = {
  kind: NoteKind
  noteId: string
  mark: string
  paragraphs: DocumentParagraphWire[]
}

export function runNoteRefs(runXml: string, runId: string): NoteRef[] {
  return [
    ...noteTags(runXml, 'footnoteReference').map((noteId) => ({
      kind: 'footnote' as const,
      noteId,
      mark: noteMark(noteId),
      runId,
    })),
    ...noteTags(runXml, 'endnoteReference').map((noteId) => ({
      kind: 'endnote' as const,
      noteId,
      mark: noteMark(noteId),
      runId,
    })),
  ]
}

export function paragraphNoteRefs(paragraph: DocumentParagraphWire): NoteRef[] {
  return paragraph.runs.flatMap((run) =>
    runNoteRefs(run.preservedXmlFragments.join(''), run.id),
  )
}

export function documentNotes(model: DocumentModelWire): NoteBody[] {
  const footnotes = noteStoryBodies(model, 'footnotes', 'footnote')
  const endnotes = noteStoryBodies(model, 'endnotes', 'endnote')
  const used = new Set<string>()
  const ordered: NoteBody[] = []
  const story = model.stories.find((item) => item.kind === 'document')
  if (!story) return [...footnotes.values(), ...endnotes.values()]
  for (const paragraph of story.paragraphs) {
    for (const ref of paragraphNoteRefs(paragraph)) {
      const key = `${ref.kind}:${ref.noteId}`
      if (used.has(key)) continue
      const body =
        ref.kind === 'footnote'
          ? footnotes.get(ref.noteId)
          : endnotes.get(ref.noteId)
      if (!body) continue
      used.add(key)
      ordered.push(body)
    }
  }
  return ordered
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
  const ids: string[] = []
  for (const tag of tags) {
    const noteId = xmlAttr(tag[1], 'id')
    if (noteId && noteId !== '-1' && noteId !== '0') ids.push(noteId)
  }
  return ids
}

function noteMark(noteId: string): string {
  return /^\d+$/.test(noteId) ? noteId : '*'
}
