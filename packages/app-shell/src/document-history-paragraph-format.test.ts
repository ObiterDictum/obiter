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
import { wireModel as model } from './document-wire-test-support'

function paragraph(id: string, pPr: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text: 'text', preservedXmlFragments: [] }],
    preservedXmlFragments: [pPr],
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

  it('drops the reversal when the result paragraph is absent from the saved model', () => {
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [pformatSlot('p1')],
      sent: formatState('p1', { alignment: 'center' }),
      fromModel: model([paragraph('p1', '<w:pPr/>')]),
      toModel: model([]),
    } satisfies SaveBaseline)
    expect(translated?.format.paragraphFormats).toEqual({})
  })

  it('keeps a pending alignment the snapshot held instead of releasing it', () => {
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
    expect(translated?.format.paragraphFormats.p1).toBeUndefined()
    const xml =
      formattedModel(
        savedModel,
        translated?.format ?? emptyFormatDrafts,
      ).stories[0]?.paragraphs[0]?.preservedXmlFragments.join('') ?? ''
    expect(xml).toContain('w:jc w:val="center"')
  })

  it('restores the pending alignment over the stored one', () => {
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
