import { describe, expect, it } from 'bun:test'
import {
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  type DocumentModelWire,
  type DocumentVersionLineage,
} from '@obiter/contracts'
import {
  applyDocumentEdits,
  createBlankDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { runPropertiesFromFragments } from './document-edits'
import { translateSnapshot } from './document-history-baseline'
import { documentStory } from './document-model-text'
import { emptyDraftState, type DraftState } from './document-save-plan'

// Character-formatting reads that feed the emphasis draft. These were split
// out of document-edits.test.ts and document-history-baseline.test.ts, both
// already over the source ceiling, rather than growing them further.
describe('character-formatting readers', () => {
  it('drops an out-of-contract font size instead of carrying it forward', () => {
    for (const value of ['0', '4000']) {
      expect(
        runPropertiesFromFragments([`<w:rPr><w:sz w:val="${value}"/></w:rPr>`])
          .fontSize,
      ).toBeNull()
    }
  })

  it('drops a font name longer than the contract limit', () => {
    const long = 'A'.repeat(DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH + 1)
    expect(
      runPropertiesFromFragments([
        `<w:rPr><w:rFonts w:ascii="${long}"/></w:rPr>`,
      ]).fontFamily,
    ).toBeNull()
  })

  it('decodes an entity-escaped font name exactly once', () => {
    expect(
      runPropertiesFromFragments([
        '<w:rPr><w:rFonts w:ascii="A&amp;B" w:hAnsi="A&amp;B"/></w:rPr>',
      ]).fontFamily,
    ).toBe('A&B')
  })

  it('survives a save and reload without double-escaping', async () => {
    const document = await parseDocx(await createBlankDocx())
    const paragraph = documentStory(document.model)?.paragraphs[0]
    if (!paragraph) throw new Error('expected a body paragraph')
    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: paragraph.id,
        runs: [{ text: 'Styled', fontFamily: 'A&B' }],
      },
    ])

    const saved = await parseDocx(await serialiseDocx(document))
    const run = documentStory(saved.model)
      ?.paragraphs.flatMap((item) => item.runs)
      .find((item) => item.text === 'Styled')
    if (!run) throw new Error('expected the styled run')
    const xml = run.preservedXmlFragments.join('')
    expect(xml).toContain('w:ascii="A&amp;B"')
    expect(xml).not.toContain('&amp;amp;')
    expect(
      runPropertiesFromFragments(run.preservedXmlFragments).fontFamily,
    ).toBe('A&B')
  })
})

describe('out-of-contract emphasis reversal', () => {
  function model(
    paragraphs: Array<{ id: string; run: string; text: string }>,
  ): DocumentModelWire {
    return {
      version: 1,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: paragraphs.map(({ id, run, text }) => ({
            id,
            runs: [{ id: run, text, preservedXmlFragments: [] }],
            preservedXmlFragments: [],
          })),
          preservedXmlFragments: [],
        },
      ],
      styles: [],
      numbering: [],
      relationships: [],
      preservedXmlFragments: [],
      changes: [],
    }
  }

  it('drops the property instead of poisoning the persisted reversal draft', () => {
    const from = model([
      { id: 'para-000001', run: 'text-000001', text: 'Clause' },
    ])
    const run = from.stories[0]?.paragraphs[0]?.runs[0]
    if (run) {
      run.preservedXmlFragments = [
        `<w:rPr><w:rFonts w:ascii="${'A'.repeat(80)}"/><w:sz w:val="0"/></w:rPr>`,
      ]
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyDraftState().format,
        emphasis: [{ runId: 'text-000001', fontFamily: 'Arial', fontSize: 24 }],
      },
    }
    const lineage: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [
        {
          fromParagraphId: 'para-000001',
          toParagraphId: 'para-w14-00000001',
          runs: [
            {
              runIndex: 0,
              segments: [
                { fromRunId: 'text-000001', fromOffset: 0, toOffset: 6 },
              ],
            },
          ],
        },
      ],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [{ kind: 'emphasis', key: 'emph:run:text-000001' }],
      sent,
      fromModel: from,
      toModel: model([
        { id: 'para-w14-00000001', run: 'text-w14-00000001', text: 'Clause' },
      ]),
      lineage,
      versionId: 'ver_2',
    })
    // The bounded reader returns null, so the reversal cannot emit a value the
    // persisted emphasis schema or the edit contract would reject.
    expect(translated?.format.emphasis).toEqual([
      expect.objectContaining({ fontFamily: null, fontSize: null }),
    ])
  })
})
