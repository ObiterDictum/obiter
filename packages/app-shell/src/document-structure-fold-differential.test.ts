import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  applyDocumentEdits,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'

import { documentStory } from './document-model-text'
import { storyBlocks } from './document-page-tables'
import { withStructuralDrafts } from './document-structure-fold'
import type { StructuralDraft } from './document-structural-drafts'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const tableDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'table',
  paragraphId,
  rows: 1,
  columns: 1,
})

const imageDraft = (
  id: string,
  paragraphId: string,
  offset: number,
  name = 'Figure',
): StructuralDraft => ({
  id,
  kind: 'image',
  paragraphId,
  offset,
  contentType: 'image/png',
  dataBase64: PNG_BASE64,
  widthPx: 10,
  heightPx: 10,
  name,
})

const operationFor = (draft: StructuralDraft): DocumentEditOperation =>
  draft.kind === 'table'
    ? {
        type: 'insert_table',
        paragraphId: draft.paragraphId,
        rows: draft.rows,
        columns: draft.columns,
      }
    : {
        type: 'insert_image',
        paragraphId: draft.paragraphId,
        offset: draft.offset,
        contentType: draft.contentType,
        dataBase64: draft.dataBase64,
        widthPx: draft.widthPx,
        heightPx: draft.heightPx,
        name: draft.name,
      }

/**
 * The fold and the writer must agree on the same placement rules — one
 * shared binding decides which wires belong to a table, so the painted
 * pending document cannot drift from what save/reload produces. Each case
 * compares block shapes and paragraph counts, not ids: pending wires carry
 * client-minted ids that canonicalisation rewrites.
 */
describe('fold-versus-reload placement', () => {
  it('matches on a legacy table whose cells carry no paragraph ids', async () => {
    const document = await parseDocx(
      await createSyntheticDocx(['Anchor', { table: { rows: 1, columns: 2 } }]),
    )
    const anchor = requiredStory(document.model).paragraphs[0]
    if (!anchor) throw new Error('Anchor paragraph is missing.')
    const structures = [tableDraft('s1', anchor.id)]

    const folded = withStructuralDrafts(document.model, structures)
    applyDocumentEdits(document, structures.map(operationFor))
    const reloaded = await parseDocx(await serialiseDocx(document))

    // The writer emits a separator before the stored table; the fold must
    // count the same paragraph, not one fewer.
    expect(blockTypes(reloaded.model)).toEqual(blockTypes(folded))
    expect(paragraphCount(reloaded.model)).toBe(paragraphCount(folded))
  })

  it('matches repeated tables at one anchor', async () => {
    const document = await parseDocx(
      await createSyntheticDocx(['Anchor', 'Tail']),
    )
    const anchor = requiredStory(document.model).paragraphs[0]
    if (!anchor) throw new Error('Anchor paragraph is missing.')
    const structures = [
      tableDraft('s1', anchor.id),
      tableDraft('s2', anchor.id),
    ]

    const folded = withStructuralDrafts(document.model, structures)
    applyDocumentEdits(document, structures.map(operationFor))
    const reloaded = await parseDocx(await serialiseDocx(document))

    expect(blockTypes(reloaded.model)).toEqual(blockTypes(folded))
    expect(paragraphCount(reloaded.model)).toBe(paragraphCount(folded))
  })

  it('matches a mixed table and picture batch', async () => {
    const document = await parseDocx(
      await createSyntheticDocx(['Anchor', 'Body text']),
    )
    const story = requiredStory(document.model)
    const anchor = story.paragraphs[0]
    const body = story.paragraphs[1]
    if (!anchor || !body) throw new Error('Fixture model is missing.')
    const structures = [
      tableDraft('s1', anchor.id),
      imageDraft('s2', body.id, 5),
    ]

    const folded = withStructuralDrafts(document.model, structures)
    applyDocumentEdits(document, structures.map(operationFor))
    const reloaded = await parseDocx(await serialiseDocx(document))

    expect(blockTypes(reloaded.model)).toEqual(blockTypes(folded))
    expect(paragraphCount(reloaded.model)).toBe(paragraphCount(folded))
    // The picture folded into 'Body text' lands where the writer put it: a
    // drawing run splits 'Body ' from 'text'.
    const foldedBody = requiredStory(folded).paragraphs.find(
      (paragraph) => paragraph.id === body.id,
    )
    const reloadedBody = documentStory(reloaded.model)?.paragraphs.find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Body text',
    )
    expect(runShapes(foldedBody?.runs ?? [])).toEqual(
      runShapes(reloadedBody?.runs ?? []),
    )
  })

  it('keeps two pictures at one effective offset in client order', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const story = requiredStory(document.model)
    const anchor = story.paragraphs[0]
    const run = anchor?.runs[0]
    if (!anchor || !run) throw new Error('Fixture model is missing.')

    // The client folds the typed text then the pictures; save replays the
    // same batch — text replacement first, then both insertions at the same
    // effective offset.
    const drafts = { [run.id]: 'Hello brave world' }
    const structures = [
      imageDraft('s1', anchor.id, 6, 'Figure0'),
      imageDraft('s2', anchor.id, 6, 'Figure1'),
    ]
    const folded = withStructuralDrafts(document.model, structures, drafts)
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello brave world' },
      ...structures.map(operationFor),
    ])
    const reloaded = await parseDocx(await serialiseDocx(document))

    const foldedAnchor = requiredStory(folded).paragraphs.find(
      (paragraph) => paragraph.id === anchor.id,
    )
    const reloadedAnchor = documentStory(reloaded.model)?.paragraphs.find(
      (paragraph) =>
        paragraph.runs.map((candidate) => candidate.text).join('') ===
        'Hello brave world',
    )
    // The writer coalesces the first drawing into the head run while the
    // fold keeps it a standalone run, so compare the content sequence —
    // text chunks and drawing names in order — not run boundaries.
    expect(contentSequence(reloadedAnchor?.runs ?? [])).toEqual([
      'Hello ',
      'Figure0',
      'Figure1',
      'brave world',
    ])
    expect(contentSequence(reloadedAnchor?.runs ?? [])).toEqual(
      contentSequence(foldedAnchor?.runs ?? []),
    )
  })
})

function blockTypes(model: Parameters<typeof documentStory>[0]) {
  const story = documentStory(model)
  if (!story) throw new Error('Document story is missing.')
  return storyBlocks(story).map((block) => block.type)
}

function paragraphCount(model: Parameters<typeof documentStory>[0]) {
  return documentStory(model)?.paragraphs.length ?? -1
}

function requiredStory(model: Parameters<typeof documentStory>[0]) {
  const story = documentStory(model)
  if (!story) throw new Error('Document story is missing.')
  return story
}

function runShapes(runs: readonly { text: string; id: string }[]) {
  return runs.map((run) => run.text.length)
}

/** A run's content in order: its text, then each drawing's `wp:docPr` name. */
function contentSequence(
  runs: readonly {
    text: string
    preservedXmlFragments: readonly string[]
  }[],
) {
  return runs.flatMap((run) => [
    ...(run.text.length > 0 ? [run.text] : []),
    ...run.preservedXmlFragments
      .filter((fragment) => fragment.includes('<w:drawing'))
      .map((fragment) => /name="([^"]*)"/u.exec(fragment)?.[1] ?? ''),
  ])
}
