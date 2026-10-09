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
} from '@obiter/ooxml'
import {
  footnoteNoteParagraphId,
  type StructuralDraft,
} from './document-structural-drafts'
import { documentStory } from './document-model-text'

const FOOTNOTE_ID =
  /<w:footnote\b[^>]*\bw:id="(-?\d+)"|<w:footnoteReference\b[^>]*\bw:id="(-?\d+)"/gu

/**
 * Folds each pending footnote draft into the painted model:
 *
 * - The reference: a zero-length run carrying the `w:footnoteReference`
 *   fragment, spliced into the body paragraph's runs at the caret offset —
 *   the same wire a reparse yields, so `runNoteRefs` paints the mark through
 *   the stored-reference path and the editable text gains no character.
 * - The entry: a `w:footnote` fragment plus one paragraph wire, appended to
 *   the footnotes story — created when the package carries none, with the
 *   separator entries the writer emits. The note paragraph folds with the
 *   draft-derived id `footnoteNoteParagraphId`, so the text the user types
 *   into it lands in `extraRuns` under a key that never names a stored
 *   paragraph.
 *
 * The fragments come from the same `structure-xml` builders the writer
 * calls, so the pending entry paints exactly the markup the save writes; the
 * note's pending `w:id` counts above every stored id and stays stable for
 * the session.
 */
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
  return { ...model, stories }
}

/**
 * The footnotes story with the pending entries appended — created, with the
 * separator entries the writer emits, when the model has none. Each pending
 * note paragraph is the entry's only `w:p`, matching the writer's
 * one-paragraph entry: the mark run is folded in, the note's own text is
 * not — it lives in `extraRuns` under the note paragraph id.
 */
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

/**
 * The painted note paragraph: the `FootnoteReference` mark run and nothing
 * else — the note's text is typed into `extraRuns`, whose runs append after
 * the mark run exactly as a reloaded paragraph's text run follows it.
 */
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
          '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>',
          '<w:footnoteRef/>',
        ],
      },
    ],
    preservedXmlFragments: ['<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'],
  }
}

/**
 * One above the highest `w:id` any stored entry or body reference names —
 * the writer's allocation rule applied to the painted model so a pending
 * mark never reuses an id and never collides with a second pending note.
 * The footnotes story alone is not enough: a stored `w:footnoteReference`
 * can outlive its entry.
 */
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

/**
 * Splices a zero-length run into the paragraph wire at the effective-text
 * offset, splitting the run that contains it — the wire counterpart of the
 * writer's `spliceInlineXml` + `spliceRunWires`, used by both the image and
 * the footnote-reference folds.
 *
 * The offset addresses effective text (typed drafts included), exactly as
 * the writer's whole-run replacement composes the markup into the pending
 * text. A run the draft state replaces wholesale splits the same way, but
 * neither half can keep the run's id: the drafts map would repaint the full
 * replacement text on whichever half kept it.
 */
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
