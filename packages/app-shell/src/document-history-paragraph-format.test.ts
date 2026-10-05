import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { formattedModel } from './document-format-edits'
import { emptyFormatDrafts } from './document-format-types'
import {
  emptyDraftState,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'
import {
  translateSnapshot,
  type SaveBaseline,
} from './document-history-baseline'

/*
 * E3 paragraph-format reversal. `translateSnapshot` re-expresses a snapshot a
 * save covered against the saved baseline, so undo restores the pre-save
 * paragraph layout rather than doing nothing. The reversal must be a complete
 * snapshot: the writer merges `w:ind`, so an omitted attribute lets a value the
 * save added survive its own undo.
 */

function paragraph(id: string, pPr: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [pPr],
  }
}

function model(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
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

function pformatSlot(paragraphId: string): DraftSlot {
  return {
    kind: 'paragraph-format',
    key: `pformat:${paragraphId}`,
    paragraphId,
  }
}

function formatState(
  paragraphId: string,
  draft: DraftState['format']['paragraphFormats'][string],
): DraftState {
  return {
    ...emptyDraftState(),
    format: {
      ...emptyFormatDrafts,
      paragraphFormats: { [paragraphId]: draft },
    },
  }
}

/** The paragraph XML a reversal draft would paint onto the saved paragraph. */
function paintedParagraph(
  saved: DocumentModelWire,
  paragraphId: string,
  draft: DraftState['format']['paragraphFormats'][string],
): string {
  return (
    formattedModel(saved, {
      ...emptyFormatDrafts,
      paragraphFormats: { [paragraphId]: draft },
    }).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
  )
}

describe('paragraph-format reversal', () => {
  it('restores a partial pre-save indent and releases the special indent the save added', () => {
    const fromModel = model([
      paragraph('p1', '<w:pPr><w:ind w:left="720"/></w:pPr>'),
    ])
    const savedModel = model([
      paragraph('p1', '<w:pPr><w:ind w:left="720" w:firstLine="720"/></w:pPr>'),
    ])
    const baseline: SaveBaseline = {
      covered: [pformatSlot('p1')],
      sent: formatState('p1', { indentation: { firstLine: 720 } }),
      fromModel,
    }

    const translated = translateSnapshot(emptyDraftState(), baseline)
    const inverse = translated?.format.paragraphFormats.p1
    // Every attribute is named, including the ones the paragraph did not carry,
    // so the merge cannot keep the `firstLine` the save wrote.
    expect(inverse).toEqual({
      indentation: { left: 720, right: null, firstLine: null, hanging: null },
    })
    if (!inverse) throw new Error('expected a reversal')
    const xml = paintedParagraph(savedModel, 'p1', inverse)
    expect(xml).toContain('w:left="720"')
    expect(xml).not.toMatch(/w:(firstLine|hanging)=/u)
  })

  it('restates the pre-save alignment and line spacing', () => {
    const fromModel = model([
      paragraph(
        'p1',
        '<w:pPr><w:jc w:val="both"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>',
      ),
    ])
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [pformatSlot('p1')],
      sent: formatState('p1', {
        alignment: 'right',
        lineSpacing: { line: 240, lineRule: 'auto' },
      }),
      fromModel,
    } satisfies SaveBaseline)
    expect(translated?.format.paragraphFormats.p1).toEqual({
      alignment: 'both',
      lineSpacing: { line: 360, lineRule: 'auto' },
    })
  })

  it('releases an alignment the paragraph did not carry before the save', () => {
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [pformatSlot('p1')],
      sent: formatState('p1', { alignment: 'center' }),
      fromModel: model([paragraph('p1', '<w:pPr/>')]),
    } satisfies SaveBaseline)
    expect(translated?.format.paragraphFormats.p1).toEqual({ alignment: null })
  })

  it('keeps a pending alignment the snapshot held instead of releasing it', () => {
    // Align centre, then type a character. The snapshot recorded for the
    // keystroke still holds the pending alignment and the save stores it, so
    // undoing the save must not release the saved centring.
    const fromModel = model([paragraph('p1', '<w:pPr/>')])
    const savedModel = model([
      paragraph('p1', '<w:pPr><w:jc w:val="center"/></w:pPr>'),
    ])
    const translated = translateSnapshot(
      formatState('p1', { alignment: 'center' }),
      {
        covered: [pformatSlot('p1')],
        sent: formatState('p1', { alignment: 'center' }),
        fromModel,
      } satisfies SaveBaseline,
    )
    // The snapshot already describes what the save stored, so the reversal is
    // dropped rather than releasing the alignment to null.
    expect(translated?.format.paragraphFormats.p1).toBeUndefined()
    // The painted paragraph keeps its saved centring.
    const xml =
      formattedModel(
        savedModel,
        translated?.format ?? emptyFormatDrafts,
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    expect(xml).toContain('w:jc w:val="center"')
  })

  it('restores the pending alignment over the stored one', () => {
    // The snapshot predates a later change the save stored. Its pending centre
    // is the pre-save answer to restore, not the stored paragraph's absent
    // alignment (which would release to null) nor the save's right.
    const translated = translateSnapshot(
      formatState('p1', { alignment: 'center' }),
      {
        covered: [pformatSlot('p1')],
        sent: formatState('p1', { alignment: 'right' }),
        fromModel: model([paragraph('p1', '<w:pPr/>')]),
      } satisfies SaveBaseline,
    )
    expect(translated?.format.paragraphFormats.p1).toEqual({
      alignment: 'center',
    })
  })
})
