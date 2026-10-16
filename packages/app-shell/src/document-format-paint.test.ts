import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'

import { emptyFormatDrafts, restartList } from './document-format-edits'
import { formattedModel } from './document-format-paint'
import { documentListMarkers } from './document-page-lists'

describe('painted list restart without an abstract numbering', () => {
  const model: DocumentModelWire = {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: ['p1', 'p2'].map((id) => ({
          id,
          runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
          preservedXmlFragments: [
            '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          ],
        })),
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    // The instance names no `w:abstractNumId`, which the server rejects for a
    // restart (`resolveParagraphNumbering` throws `invalid-document-edit`).
    numbering: [
      {
        numberingId: '1',
        sourceFragment: '<w:num w:numId="1"/>',
        levels: [{ ilvl: 0, start: 1, numFmt: 'decimal' }],
      },
    ],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }

  it('does not synthesise an instance the save would reject', () => {
    const second = model.stories[0]?.paragraphs[1]
    if (!second) throw new Error('test target paragraph is missing.')
    const format = restartList(emptyFormatDrafts, model, second)
    // The draft still records the intent; the preview must simply not claim it.
    expect(format.numbering.p2).toEqual({
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })

    const painted = formattedModel(model, format)
    expect(painted.numbering.map((instance) => instance.numberingId)).toEqual([
      '1',
    ])
    expect(
      painted.stories[0]?.paragraphs[1]?.preservedXmlFragments.join(''),
    ).toContain('<w:numId w:val="1"/>')
    // Without a synthesised instance the counter continues 1., 2. instead of
    // restarting at 1. as it would if the save accepted the draft.
    expect(documentListMarkers(painted).get('p2')?.text).toBe('2.')
  })
})
