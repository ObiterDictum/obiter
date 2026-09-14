import { describe, expect, it } from 'vitest'
import {
  applyDocumentEdits,
  createBlankDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { collectEditOperations } from './document-edits'
import { documentStory } from './document-model-text'
import { emptyFormatDrafts } from './document-format-edits'

// E44 app-shell leg: typing a word and formatting it before the first save
// must produce one request whose replacement text and range emphasis share the
// drafted paragraph coordinate space.
describe('draft-to-request construction for typing plus formatting', () => {
  it('emits the replacement then the emphasis in draft coordinates', async () => {
    const { paragraph, run } = await seedParagraph('Hello')
    const typed = `${run.text} tailword`
    const operations = collectEditOperations(
      paragraph.model,
      { [run.id]: typed },
      [],
      [],
      {},
      {
        ...emptyFormatDrafts,
        emphasis: [
          {
            paragraphId: paragraph.id,
            from: run.text.length + 1,
            to: typed.length,
            underline: true,
          },
        ],
      },
    )

    expect(operations).toEqual([
      { type: 'replace_run_text', runId: run.id, text: typed },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: run.text.length + 1,
        to: typed.length,
        underline: true,
      },
    ])
  })

  it('saves and reloads the typed text with only the selected tail emphasised', async () => {
    const { document, paragraph, run } = await seedParagraph('Hello')
    const typed = `${run.text} tailword`
    const operations = collectEditOperations(
      paragraph.model,
      { [run.id]: typed },
      [],
      [],
      {},
      {
        ...emptyFormatDrafts,
        emphasis: [
          {
            paragraphId: paragraph.id,
            from: run.text.length + 1,
            to: typed.length,
            underline: true,
          },
        ],
      },
    )

    applyDocumentEdits(document, operations)
    const saved = await parseDocx(await serialiseDocx(document))
    const edited = documentStory(saved.model)?.paragraphs.find(
      (item) => item.id === paragraph.id,
    )
    if (!edited) throw new Error('Saved paragraph is missing.')
    expect(edited.runs.map((item) => item.text).join('')).toBe(typed)
    expect(
      edited.runs
        .filter((item) =>
          /<w:u\b(?![^>]*w:val="0")/u.test(item.preservedXmlFragments.join('')),
        )
        .map((item) => item.text)
        .join(''),
    ).toBe('tailword')
    expect(edited.runs[0]?.id).toBe(run.id)
    expect(new Set(edited.runs.map((item) => item.id)).size).toBe(
      edited.runs.length,
    )
  })
})

async function seedParagraph(text: string) {
  const document = await parseDocx(await createBlankDocx())
  const host = documentStory(document.model)?.paragraphs[0]
  if (!host) throw new Error('Blank document has no body paragraph.')
  applyDocumentEdits(document, [
    {
      type: 'insert_paragraph_after',
      paragraphId: host.id,
      runs: [{ text }],
    },
  ])
  const seeded = await parseDocx(await serialiseDocx(document))
  const paragraph = documentStory(seeded.model)?.paragraphs[1]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Seeded paragraph is missing.')
  return {
    document: seeded,
    paragraph: { id: paragraph.id, model: seeded.model },
    run,
  }
}
