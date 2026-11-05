import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  buildFootnoteReferenceRunXml,
  buildFootnoteSeparatorXml,
  buildFootnoteXml,
  FOOTNOTES_PART_NAME,
  missingFootnoteStyles,
} from '@obiter/ooxml'
import {
  footnoteNoteParagraphId,
  type StructuralDraft,
} from './document-structural-drafts'
import { documentStory } from './document-model-text'
import {
  selectionSegmentMap,
  type DocumentSelection,
  type SelectionSegment,
} from './document-selection'
import { storyFlowOrder } from './document-story-flow'
import {
  blockRuns,
  blockText,
  type EditorResult,
  type EditorState,
} from './document-word-edits'

const FOOTNOTE_ID =
  /<w:footnote\b[^>]*\bw:id="(-?\d+)"|<w:footnoteReference\b[^>]*\bw:id="(-?\d+)"/gu

export function foldFootnoteDrafts(
  model: DocumentModelWire,
  footnotes: readonly (StructuralDraft & { kind: 'footnote' })[],
  drafts: Record<string, string>,
  nextParaId: () => string,
): DocumentModelWire {
  if (footnotes.length === 0) return model
  const body = documentStory(model)
  if (!body) return model

  const stories = [...model.stories]
  const storyIndex = stories.findIndex((story) => story.kind === 'footnotes')
  const noteStory = storyIndex === -1 ? undefined : stories[storyIndex]

  let nextNoteId = nextPendingFootnoteId(model, noteStory)
  let bodyChanged = false
  const bodyParagraphs = [...body.paragraphs]
  const spliced: {
    draft: StructuralDraft & { kind: 'footnote' }
    noteId: number
  }[] = []

  for (const draft of footnotes) {
    const paragraph = bodyParagraphs.find(
      (item) => item.id === draft.paragraphId,
    )
    if (!paragraph) continue
    const noteId = nextNoteId
    nextNoteId += 1
    const reference: DocumentTextRunWire = {
      id: `${draft.id}:ref`,
      styleId: 'FootnoteReference',
      text: '',
      preservedXmlFragments: [buildFootnoteReferenceRunXml(noteId)],
    }
    const folded = spliceRunAtOffset(
      paragraph,
      draft.offset,
      reference,
      drafts,
      `${draft.id}:ref`,
    )
    bodyParagraphs.splice(bodyParagraphs.indexOf(paragraph), 1, folded)
    spliced.push({ draft, noteId })
    bodyChanged = true
  }
  if (!bodyChanged) return model

  stories[stories.indexOf(body)] = { ...body, paragraphs: bodyParagraphs }
  if (storyIndex === -1) {
    stories.push(foldedNoteStory(undefined, spliced, nextParaId))
  } else {
    stories[storyIndex] = foldedNoteStory(noteStory, spliced, nextParaId)
  }
  const styles = missingFootnoteStyles(model.styles)
  return {
    ...model,
    stories,
    ...(styles.length ? { styles: [...model.styles, ...styles] } : {}),
  }
}

function foldedNoteStory(
  story: DocumentStoryWire | undefined,
  spliced: readonly {
    draft: StructuralDraft & { kind: 'footnote' }
    noteId: number
  }[],
  nextParaId: () => string,
): DocumentStoryWire {
  const base: DocumentStoryWire = story ?? {
    partName: FOOTNOTES_PART_NAME,
    kind: 'footnotes',
    paragraphs: [],
    preservedXmlFragments: [],
    fields: [],
    unanchoredFieldParagraphIds: [],
  }
  const paragraphs = [...base.paragraphs]
  const fragments = [...base.preservedXmlFragments]
  if (!story) {
    for (const entry of [
      { id: -1, kind: 'separator' },
      { id: 0, kind: 'continuationSeparator' },
    ] as const) {
      const paraId = nextParaId()
      fragments.push(buildFootnoteSeparatorXml(entry.id, entry.kind, paraId))
      paragraphs.push({
        id: `para-w14-${paraId}`,
        sourceParaId: paraId,
        runs: [
          {
            id: `${entry.kind}-run`,
            text: '',
            preservedXmlFragments: [`<w:${entry.kind}/>`],
          },
        ],
        preservedXmlFragments: [],
      })
    }
  }
  for (const { draft, noteId } of spliced) {
    const paraId = nextParaId()
    fragments.push(buildFootnoteXml(noteId, '', paraId))
    paragraphs.push(noteParagraphWire(draft, paraId))
  }
  return { ...base, paragraphs, preservedXmlFragments: fragments }
}

function noteParagraphWire(
  draft: StructuralDraft & { kind: 'footnote' },
  paraId: string,
): DocumentParagraphWire {
  return {
    id: footnoteNoteParagraphId(draft),
    sourceParaId: paraId,
    styleId: 'FootnoteText',
    runs: [
      {
        id: `${draft.id}:mark`,
        styleId: 'FootnoteReference',
        text: '',
        preservedXmlFragments: [
          '<w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>',
          '<w:footnoteRef/>',
        ],
      },
    ],
    preservedXmlFragments: ['<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'],
  }
}

function nextPendingFootnoteId(
  model: DocumentModelWire,
  story: DocumentStoryWire | undefined,
): number {
  let next = 1
  const consider = (fragment: string) => {
    for (const match of fragment.matchAll(FOOTNOTE_ID)) {
      const raw = match[1] ?? match[2]
      const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
      if (Number.isInteger(value) && value >= next) next = value + 1
    }
  }
  for (const item of model.stories) {
    if (item.kind !== 'document' && item !== story) continue
    for (const paragraph of item.paragraphs) {
      for (const run of paragraph.runs) {
        for (const fragment of run.preservedXmlFragments) consider(fragment)
      }
    }
    for (const fragment of item.preservedXmlFragments) consider(fragment)
  }
  return next
}

export function spliceRunAtOffset(
  paragraph: DocumentParagraphWire,
  offset: number,
  inserted: DocumentTextRunWire | readonly DocumentTextRunWire[],
  drafts: Record<string, string>,
  idPrefix: string,
): DocumentParagraphWire {
  const insertedRuns = Array.isArray(inserted) ? inserted : [inserted]
  const runs = [...paragraph.runs]
  let cursor = 0
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (!run) break
    const effective = drafts[run.id] ?? run.text
    if (effective.length === 0) continue
    const end = cursor + effective.length
    if (offset <= cursor) {
      runs.splice(index, 0, ...insertedRuns)
      return { ...paragraph, runs }
    }
    if (offset < end) {
      const within = offset - cursor
      const drafted = drafts[run.id] !== undefined
      const head: DocumentTextRunWire = {
        ...run,
        ...(drafted ? { id: `${idPrefix}:head` } : {}),
        text: effective.slice(0, within),
      }
      const tail: DocumentTextRunWire = {
        ...run,
        id: `${idPrefix}:tail`,
        text: effective.slice(within),
        preservedXmlFragments: run.preservedXmlFragments.filter((fragment) =>
          /^<w:rPr\b/u.test(fragment),
        ),
      }
      runs.splice(index, 1, head, ...insertedRuns, tail)
      return { ...paragraph, runs }
    }
    cursor = end
  }
  runs.push(...insertedRuns)
  return { ...paragraph, runs }
}

export function followFootnoteEdits(
  model: DocumentModelWire,
  before: EditorState,
  after: EditorResult,
  structures: readonly StructuralDraft[],
  newId: () => string,
  selection?: DocumentSelection,
) {
  const body = documentStory(model)
  const structureChanged =
    before.inserts.length !== after.state.inserts.length ||
    before.deletedParagraphIds.length !== after.state.deletedParagraphIds.length
  const selected = selection
    ? selectionSegmentMap(
        {
          order: storyFlowOrder(
            model,
            before.inserts,
            before.deletedParagraphIds,
            selection.anchor.paragraphId,
          ),
          textOf: (id) => blockText(model, before, id),
        },
        selection,
      )
    : new Map<string, SelectionSegment>()
  const firstSelected = selected.keys().next().value
  const next: StructuralDraft[] = []
  const dropped = new Set<string>()
  const removals: StructuralDraft[] = []
  const regions = new Map<string, EditRegion | null>()
  const regionOf = (paragraphId: string) => {
    if (!regions.has(paragraphId)) {
      const segment = selected.get(paragraphId)
      const old = blockRuns(model, before, paragraphId)
      const now = blockRuns(model, after.state, paragraphId)
      const length = old.reduce((sum, run) => sum + run.text.length, 0)
      regions.set(
        paragraphId,
        segment
          ? {
              from: paragraphId === firstSelected ? segment.from : -1,
              to: segment.to,
              length,
              shift: structureChanged
                ? 0
                : now.reduce((sum, run) => sum + run.text.length, 0) - length,
              selected: true,
            }
          : structureChanged
            ? null
            : editRegion(
                old,
                now,
                after.caret.paragraphId === paragraphId
                  ? after.caret.offset
                  : undefined,
              ),
      )
    }
    return regions.get(paragraphId) ?? null
  }
  for (const structure of structures) {
    if (structure.kind !== 'footnote') {
      next.push(structure)
      continue
    }
    const region = regionOf(structure.paragraphId)
    if (!region || structure.offset <= region.from) {
      next.push(structure)
    } else if (
      structure.offset > region.to ||
      (structure.offset === region.to &&
        !(region.selected && region.to === region.length))
    ) {
      next.push({ ...structure, offset: structure.offset + region.shift })
    } else {
      dropped.add(footnoteNoteParagraphId(structure))
    }
  }
  for (const paragraph of body?.paragraphs ?? []) {
    const references = paragraph.runs.filter(removableReference)
    if (references.length === 0) continue
    const region = regionOf(paragraph.id)
    if (!region) continue
    let offset = 0
    for (const run of blockRuns(model, before, paragraph.id)) {
      if (
        references.some((reference) => reference.id === run.id) &&
        region.from < offset &&
        (offset < region.to ||
          (region.selected &&
            offset === region.to &&
            region.to === region.length)) &&
        !structures.some(
          (item) => item.kind === 'footnote-removal' && item.runId === run.id,
        )
      ) {
        removals.push({
          id: newId(),
          kind: 'footnote-removal',
          paragraphId: paragraph.id,
          runId: run.id,
        })
      }
      offset += run.text.length
    }
  }
  const removedRunIds = new Set(
    removals.flatMap((removal) =>
      removal.kind === 'footnote-removal' ? [removal.runId] : [],
    ),
  )
  const keepRun = (run: DocumentTextRunWire) => !removedRunIds.has(run.id)
  const inserts = after.state.inserts.map((insert) =>
    insert.runs ? { ...insert, runs: insert.runs.filter(keepRun) } : insert,
  )
  const extraRuns = Object.fromEntries(
    Object.entries(after.state.extraRuns).map(([id, runs]) => [
      id,
      runs.filter(keepRun),
    ]),
  )
  for (const id of dropped) delete extraRuns[id]
  const drafts = { ...after.state.drafts }
  for (const removal of removals) {
    if (removal.kind === 'footnote-removal') delete drafts[removal.runId]
  }
  return { structures: [...next, ...removals], extraRuns, drafts, inserts }
}

type EditRegion = {
  from: number
  to: number
  shift: number
  length: number
  selected?: boolean
}

function editRegion(
  before: readonly DocumentTextRunWire[],
  after: readonly DocumentTextRunWire[],
  caret: number | undefined,
): EditRegion | null {
  const old = before.map((run) => run.text).join('')
  const now = after.map((run) => run.text).join('')
  if (old === now) return null
  const shortest = Math.min(old.length, now.length)
  let suffix = 0
  while (
    suffix < shortest &&
    old[old.length - 1 - suffix] === now[now.length - 1 - suffix]
  )
    suffix += 1
  if (caret !== undefined) suffix = Math.min(suffix, now.length - caret)
  let prefix = 0
  while (prefix < shortest - suffix && old[prefix] === now[prefix]) prefix += 1
  return {
    from: prefix,
    to: old.length - suffix,
    shift: now.length - old.length,
    length: old.length,
  }
}

function removableReference(run: DocumentTextRunWire): boolean {
  const xml = run.preservedXmlFragments.join('')
  return (
    run.text === '' &&
    (xml.match(/<w:footnoteReference\b/gu) ?? []).length === 1 &&
    !/customMarkFollows|<w:t\b|<w:endnoteReference|<w:commentReference/u.test(
      xml,
    )
  )
}
