import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectFormatOperations,
  continueList,
  documentFormatToolbar,
  emphasisAddress,
  emptyFormatDrafts,
  formatControlState,
  formattedModel,
  indentList,
  mergeEmphasis,
  outdentList,
  paragraphStyleOptions,
  restartList,
  type FormatDrafts,
} from './document-format-edits'
import { projectRangeEmphasis } from './document-format-paint'
import { documentListMarkers } from './document-page-lists'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          styleId: 'Heading1',
          runs: [
            {
              id: 'r1',
              text: 'Hello',
              preservedXmlFragments: ['<w:rPr/>'],
            },
          ],
          preservedXmlFragments: [
            '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          ],
        },
      ],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
  ],
  styles: [],
  numbering: [
    {
      numberingId: '1',
      sourceFragment: '<w:num w:numId="1"/>',
      levels: [
        { ilvl: 0, numFmt: 'decimal' },
        { ilvl: 1, numFmt: 'lowerLetter' },
      ],
    },
  ],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
  comments: [],
}

describe('emphasis addressing from the caret selection', () => {
  const paragraph = {
    id: 'p1',
    runs: [
      { id: 'r1', text: 'Hello ', preservedXmlFragments: [] },
      { id: 'r2', text: 'world', preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [],
  }

  it('emits a paragraph range for a non-empty selection', () => {
    expect(emphasisAddress(paragraph, 0, 2, 4)).toEqual({
      paragraphId: 'p1',
      from: 2,
      to: 4,
    })
    expect(emphasisAddress(paragraph, 5, 0, 2)).toEqual({
      paragraphId: 'p1',
      from: 5,
      to: 7,
    })
  })

  it('formats only the run that holds a collapsed caret', () => {
    expect(emphasisAddress(paragraph, 0, 8, 8)).toEqual({ runId: 'r2' })
    expect(emphasisAddress(paragraph, 0, 2, 2)).toEqual({ runId: 'r1' })
  })
})

describe('tracked emphasis from the client path', () => {
  it('queues a range emphasis while track changes is on', () => {
    // The engine records a mid-run selection as a w:rPrChange, so the client
    // must queue the draft rather than refuse it.
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      model,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { kind: 'selection', ranges: [{ paragraphId: 'p1', from: 1, to: 4 }] },
      true,
    )
    expect(toolbar.emphasisUnavailable).toBeUndefined()
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([
      { paragraphId: 'p1', from: 1, to: 4, bold: true },
    ])
  })

  it('still queues whole-run emphasis while track changes is on', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      model,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { kind: 'caret', paragraphId: 'p1', from: 2, to: 2 },
      true,
    )
    expect(toolbar.emphasisUnavailable).toBeUndefined()
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([{ runId: 'r1', bold: true }])
  })

  it('queues every character formatting control on a tracked partial selection', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = () =>
      documentFormatToolbar(
        model,
        format,
        'p1',
        (update) => {
          format = update(format)
        },
        { kind: 'selection', ranges: [{ paragraphId: 'p1', from: 1, to: 4 }] },
        true,
      )
    expect(toolbar().emphasisUnavailable).toBeUndefined()
    toolbar().onToggleStrikethrough()
    toolbar().onToggleHighlight()
    toolbar().onToggleSuperscript()
    toolbar().onFontFamily('Georgia')
    toolbar().onFontSize(28)
    toolbar().onColour('FF0000')
    toolbar().onToggleSubscript()
    // Subscript owns vertAlign on the same tracked range: the queued draft
    // restates superscript as subscript rather than stacking a second entry.
    expect(format.emphasis).toEqual([
      {
        paragraphId: 'p1',
        from: 1,
        to: 4,
        strikethrough: true,
        highlight: 'yellow',
        fontFamily: 'Georgia',
        fontSize: 28,
        colour: 'FF0000',
        vertAlign: 'subscript',
      },
    ])
    toolbar().onClearFormatting()
    expect(format.emphasis).toEqual([
      {
        paragraphId: 'p1',
        from: 1,
        to: 4,
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        vertAlign: null,
        smallCaps: null,
      },
    ])
  })
})

describe('document format drafts', () => {
  it('collects a paragraph range emphasis operation from the selection', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [{ paragraphId: 'p1', from: 2, to: 4, bold: true }],
          paragraphStyles: {},
          numbering: {},
          paragraphFormats: {},
          section: {},
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 4,
        bold: true,
      },
    ])
  })

  it('collects coalesced emphasis, style, and numbering operations', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [
            { runId: 'r1', bold: true },
            { runId: 'r1', italic: true },
          ],
          paragraphStyles: { p1: 'Base' },
          numbering: { p1: { numId: '1', ilvl: 1 } },
          paragraphFormats: {},
          section: {},
        },
        [],
      ),
    ).toEqual([
      { type: 'set_run_emphasis', runId: 'r1', italic: true },
      { type: 'set_paragraph_style', paragraphId: 'p1', styleId: 'Base' },
      {
        type: 'set_paragraph_numbering',
        paragraphId: 'p1',
        numId: '1',
        ilvl: 1,
      },
    ])
  })

  it('paints pending bold and list indent onto the local model', () => {
    const painted = formattedModel(model, {
      emphasis: [{ runId: 'r1', bold: true }],
      paragraphStyles: {},
      numbering: { p1: { numId: '1', ilvl: 1 } },
      paragraphFormats: {},
      section: {},
    })
    const paragraph = painted.stories[0]?.paragraphs[0]
    expect(paragraph?.runs[0]?.preservedXmlFragments.join('')).toContain(
      '<w:b/>',
    )
    expect(paragraph?.preservedXmlFragments.join('')).toContain(
      '<w:ilvl w:val="1"/>',
    )
  })

  it('indents then outdents using numbering levels', () => {
    const indented = indentList(
      {
        emphasis: [],
        paragraphStyles: {},
        numbering: {},
        paragraphFormats: {},
        section: {},
      },
      model,
      model.stories[0]?.paragraphs[0] ?? {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [],
      },
    )
    expect(indented.numbering.p1).toEqual({ numId: '1', ilvl: 1 })
    const outdented = outdentList(indented, model, {
      id: 'p1',
      runs: [],
      preservedXmlFragments: [],
    })
    expect(outdented.numbering.p1).toEqual({ numId: '1', ilvl: 0 })
  })

  it('merges later emphasis onto the same run', () => {
    expect(
      mergeEmphasis([{ runId: 'r1', bold: true }], {
        runId: 'r1',
        italic: true,
      }),
    ).toEqual([{ runId: 'r1', bold: true, italic: true }])
  })

  it('keeps direct paragraph formatting when a numbering draft is painted', () => {
    const styled: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...model.stories[0],
          paragraphs: [
            {
              ...model.stories[0]?.paragraphs[0],
              preservedXmlFragments: [
                '<w:pPr><w:pStyle w:val="Heading1"/><w:shd w:val="clear" w:fill="F2F2F2"/></w:pPr>',
              ],
            },
          ],
        },
      ],
    }
    const painted = formattedModel(styled, {
      emphasis: [],
      paragraphStyles: {},
      numbering: { p1: { numId: '1', ilvl: 1 } },
      paragraphFormats: {},
      section: {},
    })
    const fragments =
      painted.stories[0]?.paragraphs[0]?.preservedXmlFragments ?? []
    expect(fragments.join('')).toContain('<w:pStyle w:val="Heading1"/>')
    expect(fragments.join('')).toContain(
      '<w:shd w:val="clear" w:fill="F2F2F2"/>',
    )
    expect(fragments.join('')).toContain('<w:ilvl w:val="1"/>')
  })
})

function modelWithRuns(
  runs: DocumentModelWire['stories'][number]['paragraphs'][number]['runs'],
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [{ id: 'p1', runs, preservedXmlFragments: [] }],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }
}

const boldXml = ['<w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr>']
const plainXml = ['<w:rPr/>']

describe('formatControlState from the selection', () => {
  it('presses only when every covered run has the flag', () => {
    const allOn = modelWithRuns([
      { id: 'r1', text: 'The Claimant seeks', preservedXmlFragments: boldXml },
    ])
    expect(
      formatControlState(allOn, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 4, to: 13 },
      ]),
    ).toMatchObject({ bold: true, italic: true, underline: true })

    const allOff = modelWithRuns([
      { id: 'r1', text: 'The Claimant seeks', preservedXmlFragments: plainXml },
    ])
    expect(
      formatControlState(allOff, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 4, to: 13 },
      ]),
    ).toMatchObject({ bold: false, italic: false, underline: false })

    const mixed = modelWithRuns([
      { id: 'r1', text: 'The ', preservedXmlFragments: boldXml },
      { id: 'r2', text: 'Claimant', preservedXmlFragments: plainXml },
      { id: 'r3', text: ' seeks', preservedXmlFragments: boldXml },
    ])
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 18 },
      ]),
    ).toMatchObject({ bold: false, italic: false, underline: false })
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({ bold: true, italic: true, underline: true })
  })

  it('reports the run that holds a collapsed caret', () => {
    const mixed = modelWithRuns([
      { id: 'r1', text: 'The ', preservedXmlFragments: boldXml },
      { id: 'r2', text: 'Claimant', preservedXmlFragments: plainXml },
    ])
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 1, to: 1 },
      ]),
    ).toMatchObject({ bold: true })
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 6, to: 6 },
      ]),
    ).toMatchObject({ bold: false })
  })

  it('flips pressed after one click on a plain selection, then back', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'Hello world', preservedXmlFragments: plainXml },
    ])
    const selection = {
      kind: 'selection' as const,
      ranges: [{ paragraphId: 'p1', from: 6, to: 11 }],
    }
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = (view: DocumentModelWire) =>
      documentFormatToolbar(
        view,
        format,
        'p1',
        (update) => {
          format = update(format)
        },
        selection,
      )

    expect(toolbar(source).bold).toBe(false)
    toolbar(source).onToggleBold()
    const once = formattedModel(source, format)
    expect(toolbar(once).bold).toBe(true)
    toolbar(once).onToggleBold()
    expect(toolbar(formattedModel(source, format)).bold).toBe(false)
  })

  it('reads painted splits after a range draft on an unsplit bold paragraph', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'The Claimant seeks', preservedXmlFragments: boldXml },
    ])
    const format: FormatDrafts = {
      emphasis: [{ paragraphId: 'p1', from: 4, to: 13, bold: false }],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    }
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 4, to: 13 },
      ]),
    ).toMatchObject({ bold: false })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 13, to: 18 },
      ]),
    ).toMatchObject({ bold: true })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({ bold: true })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 4, to: 18 },
      ]),
    ).toMatchObject({ bold: false })
  })

  it('reads painted splits after a range draft on an unsplit plain paragraph', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'The Claimant seeks', preservedXmlFragments: plainXml },
    ])
    const format: FormatDrafts = {
      emphasis: [{ paragraphId: 'p1', from: 4, to: 13, bold: true }],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    }
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 4, to: 13 },
      ]),
    ).toMatchObject({ bold: true })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 13, to: 18 },
      ]),
    ).toMatchObject({ bold: false })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({ bold: false })
    expect(
      formatControlState(source, format, 'p1', [
        { paragraphId: 'p1', from: 4, to: 18 },
      ]),
    ).toMatchObject({ bold: false })
  })
  it('reads an unsaved suffix selection through the effective paragraph', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'Hello', preservedXmlFragments: plainXml },
    ])
    const drafts = { r1: 'Hello!' }
    const format: FormatDrafts = {
      emphasis: [{ paragraphId: 'p1', from: 5, to: 6, bold: true }],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    }
    // The stored paragraph ends at offset 5: without the drafts this cover is
    // empty and every flag reads false while the screen paints bold.
    expect(
      formatControlState(source, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 5, to: 6 },
      ]),
    ).toMatchObject({ bold: false })
    expect(
      formatControlState(
        source,
        format,
        'p1',
        [{ paragraphId: 'p1', from: 5, to: 6 }],
        undefined,
        drafts,
      ),
    ).toMatchObject({ bold: true })
    expect(
      formatControlState(
        source,
        format,
        'p1',
        [{ paragraphId: 'p1', from: 0, to: 6 }],
        undefined,
        drafts,
      ),
    ).toMatchObject({ bold: false })
  })

  it('restates the same addressed range instead of stacking entries', () => {
    const on = mergeEmphasis([], {
      paragraphId: 'p1',
      from: 5,
      to: 6,
      bold: true,
    })
    expect(on).toEqual([{ paragraphId: 'p1', from: 5, to: 6, bold: true }])
    const off = mergeEmphasis(on, {
      paragraphId: 'p1',
      from: 5,
      to: 6,
      bold: false,
    })
    expect(off).toEqual([{ paragraphId: 'p1', from: 5, to: 6, bold: false }])
    // A different range stays its own entry, and a second flag merges in.
    expect(
      mergeEmphasis(off, { paragraphId: 'p1', from: 0, to: 2, italic: true }),
    ).toHaveLength(2)
    expect(
      mergeEmphasis(off, { paragraphId: 'p1', from: 5, to: 6, italic: true }),
    ).toEqual([
      { paragraphId: 'p1', from: 5, to: 6, bold: false, italic: true },
    ])
  })

  it('addresses a run outside the stored ids by its paragraph span', () => {
    const paragraph = {
      id: 'p1',
      runs: [
        { id: 'p1-r', text: 'Alpha', preservedXmlFragments: [] as string[] },
        { id: 'p2-r', text: 'Bravo', preservedXmlFragments: [] as string[] },
      ],
      preservedXmlFragments: [] as string[],
    }
    const storedIds = new Set(['p1-r'])
    expect(emphasisAddress(paragraph, 0, 7, 7, storedIds)).toEqual({
      paragraphId: 'p1',
      from: 5,
      to: 10,
    })
    expect(emphasisAddress(paragraph, 0, 7, 7, storedIds)).not.toHaveProperty(
      'runId',
    )
    expect(emphasisAddress(paragraph, 0, 2, 2, storedIds)).toEqual({
      runId: 'p1-r',
    })
    expect(emphasisAddress(paragraph, 0, 7, 7)).toEqual({ runId: 'p2-r' })
  })
})

describe('character formatting controls', () => {
  it('collects highlight, strikethrough and vertical align for a run and a range', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [
            {
              runId: 'r1',
              strikethrough: true,
              highlight: 'yellow',
              vertAlign: 'superscript',
            },
            {
              paragraphId: 'p1',
              from: 1,
              to: 3,
              highlight: 'none',
              vertAlign: 'baseline',
            },
          ],
          paragraphStyles: {},
          numbering: {},
          paragraphFormats: {},
          section: {},
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_run_emphasis',
        runId: 'r1',
        strikethrough: true,
        highlight: 'yellow',
        vertAlign: 'superscript',
      },
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 1,
        to: 3,
        highlight: 'none',
        vertAlign: 'baseline',
      },
    ])
  })

  it('paints strike, highlight and vertical align onto the draft model', () => {
    const painted = formattedModel(model, {
      emphasis: [
        {
          runId: 'r1',
          strikethrough: true,
          highlight: 'yellow',
          vertAlign: 'subscript',
        },
      ],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    })
    const fragments = (
      painted.stories[0]?.paragraphs[0]?.runs[0]?.preservedXmlFragments ?? []
    ).join('')
    expect(fragments).toContain('<w:strike/>')
    expect(fragments).toContain('<w:highlight w:val="yellow"/>')
    expect(fragments).toContain('<w:vertAlign w:val="subscript"/>')
  })

  it('strips a released highlight and returns vertical align to baseline', () => {
    const painted = formattedModel(
      modelWithRuns([
        {
          id: 'r1',
          text: 'The Claimant',
          preservedXmlFragments: [
            '<w:rPr><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr>',
          ],
        },
      ]),
      {
        emphasis: [
          {
            runId: 'r1',
            highlight: 'none',
            vertAlign: 'baseline',
          },
        ],
        paragraphStyles: {},
        numbering: {},
        paragraphFormats: {},
        section: {},
      },
    )
    const fragments = (
      painted.stories[0]?.paragraphs[0]?.runs[0]?.preservedXmlFragments ?? []
    ).join('')
    expect(fragments).toContain('<w:highlight w:val="none"/>')
    expect(fragments).toContain('<w:vertAlign w:val="baseline"/>')
  })

  it('reports pressed flags and values from the covered runs', () => {
    const formatted = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(formatted, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({
      strikethrough: true,
      highlight: 'yellow',
      vertAlign: 'superscript',
    })

    const plain = modelWithRuns([
      { id: 'r1', text: 'The Claimant', preservedXmlFragments: plainXml },
    ])
    expect(
      formatControlState(plain, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({
      strikethrough: false,
      highlight: null,
      vertAlign: 'baseline',
    })
  })

  it('reports mixed highlight and vertical align as untouched', () => {
    const mixed = modelWithRuns([
      {
        id: 'r1',
        text: 'The ',
        preservedXmlFragments: [
          '<w:rPr><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr>',
        ],
      },
      { id: 'r2', text: 'Claimant', preservedXmlFragments: plainXml },
    ])
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 11 },
      ]),
    ).toMatchObject({ strikethrough: false, highlight: null, vertAlign: null })
  })

  it('reads every off spelling of a flag as off', () => {
    for (const value of ['0', 'false', 'off']) {
      const stored = modelWithRuns([
        {
          id: 'r1',
          text: 'The Claimant',
          preservedXmlFragments: [
            `<w:rPr><w:strike w:val="${value}"/></w:rPr>`,
          ],
        },
      ])
      expect(
        formatControlState(stored, emptyFormatDrafts, 'p1', [
          { paragraphId: 'p1', from: 0, to: 4 },
        ]).strikethrough,
      ).toBe(false)
    }
  })

  it('ignores properties that exist only inside a tracked rPrChange', () => {
    const historical = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr></w:rPrChange></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(historical, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({
      strikethrough: false,
      highlight: null,
      vertAlign: 'baseline',
    })
  })

  it('keeps current properties after a self-closing tracked change', () => {
    const stored = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1"/><w:b/><w:rPrChange w:id="2"><w:rPr><w:strike/></w:rPr></w:rPrChange></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(stored, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({ bold: true, strikethrough: false })
  })

  it('pairs a nested tracked change with its own close', () => {
    const stored = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1"><w:rPr><w:b/><w:rPrChange w:id="2"><w:rPr><w:i/></w:rPr></w:rPrChange><w:strike/></w:rPr></w:rPrChange><w:u w:val="single"/></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(stored, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({
      bold: false,
      underline: true,
      strikethrough: false,
    })
  })

  it('matches case variants to the same options paint uses', () => {
    const stored = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:highlight w:val="DARKBLUE"/><w:vertAlign w:val="SUPERSCRIPT"/></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(stored, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({ highlight: 'darkBlue', vertAlign: 'superscript' })
  })
})

describe('font formatting controls', () => {
  it('collects font family, size, colour and small caps for a run and a range', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [
            {
              runId: 'r1',
              fontFamily: 'Georgia',
              fontSize: 28,
              colour: 'FF0000',
              smallCaps: true,
            },
            {
              paragraphId: 'p1',
              from: 1,
              to: 3,
              fontFamily: null,
              fontSize: null,
              colour: null,
            },
          ],
          paragraphStyles: {},
          numbering: {},
          paragraphFormats: {},
          section: {},
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_run_emphasis',
        runId: 'r1',
        fontFamily: 'Georgia',
        fontSize: 28,
        colour: 'FF0000',
        smallCaps: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 1,
        to: 3,
        fontFamily: null,
        fontSize: null,
        colour: null,
      },
    ])
  })

  it('paints font family, size and colour onto the draft model', () => {
    const painted = formattedModel(model, {
      emphasis: [
        {
          runId: 'r1',
          fontFamily: 'Georgia',
          fontSize: 28,
          colour: 'FF0000',
        },
      ],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    })
    const fragments = (
      painted.stories[0]?.paragraphs[0]?.runs[0]?.preservedXmlFragments ?? []
    ).join('')
    expect(fragments).toContain(
      '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>',
    )
    expect(fragments).toContain('<w:sz w:val="28"/>')
    expect(fragments).toContain('<w:szCs w:val="28"/>')
    expect(fragments).toContain('<w:color w:val="FF0000"/>')
  })

  it('paints emphasis without disturbing a nested rPrChange history', () => {
    const tracked = modelWithRuns([
      {
        id: 'r1',
        text: 'Clause',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:rFonts w:ascii="Old" w:hAnsi="Old"/></w:rPr></w:rPrChange></w:rPr>',
        ],
      },
    ])
    const painted = formattedModel(tracked, {
      emphasis: [{ runId: 'r1', fontFamily: 'Georgia' }],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    })
    const fragment = (
      painted.stories[0]?.paragraphs[0]?.runs[0]?.preservedXmlFragments ?? []
    ).join('')
    // The active run gains the new font while the historical w:rPrChange
    // subtree keeps the font it recorded.
    expect(fragment).toContain('w:ascii="Georgia"')
    expect(fragment).toContain('w:ascii="Old"')
  })

  it('clears every direct character property at once', () => {
    const decorated = modelWithRuns([
      {
        id: 'r1',
        text: 'Styled',
        preservedXmlFragments: [
          '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i/><w:u w:val="single"/><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="FF0000"/><w:smallCaps/></w:rPr>',
        ],
      },
    ])
    const painted = formattedModel(decorated, {
      emphasis: [
        {
          runId: 'r1',
          bold: null,
          italic: null,
          underline: null,
          strikethrough: null,
          fontFamily: null,
          fontSize: null,
          colour: null,
          highlight: null,
          vertAlign: null,
          smallCaps: null,
        },
      ],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    })
    const fragments = (
      painted.stories[0]?.paragraphs[0]?.runs[0]?.preservedXmlFragments ?? []
    ).join('')
    for (const element of [
      'w:b',
      'w:i',
      'w:u',
      'w:strike',
      'w:highlight',
      'w:vertAlign',
      'w:rFonts',
      'w:sz',
      'w:szCs',
      'w:color',
      'w:smallCaps',
    ]) {
      expect(fragments, element).not.toContain(`<${element}`)
    }
  })

  it('reads the effective font family, size and colour from the covered run', () => {
    const formatted = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="28"/><w:color w:val="ff0000"/></w:rPr>',
        ],
      },
    ])
    expect(
      formatControlState(formatted, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 4 },
      ]),
    ).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: 28,
      colour: 'FF0000',
    })
  })

  it('reports mixed font values as unset', () => {
    const mixed = modelWithRuns([
      {
        id: 'r1',
        text: 'The ',
        preservedXmlFragments: [
          '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="28"/></w:rPr>',
        ],
      },
      { id: 'r2', text: 'Claimant', preservedXmlFragments: plainXml },
    ])
    expect(
      formatControlState(mixed, emptyFormatDrafts, 'p1', [
        { paragraphId: 'p1', from: 0, to: 11 },
      ]),
    ).toMatchObject({ fontFamily: null, fontSize: null, colour: null })
  })

  it('applies a chosen font and reads it back through the toolbar', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'The Claimant', preservedXmlFragments: plainXml },
    ])
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = (view: DocumentModelWire) =>
      documentFormatToolbar(
        view,
        format,
        'p1',
        (update) => {
          format = update(format)
        },
        { kind: 'selection', ranges: [{ paragraphId: 'p1', from: 0, to: 12 }] },
      )

    toolbar(source).onFontFamily('Georgia')
    toolbar(source).onFontSize(28)
    toolbar(source).onColour('FF0000')
    const painted = toolbar(formattedModel(source, format))
    expect(painted.fontFamily).toBe('Georgia')
    expect(painted.fontSize).toBe(28)
    expect(painted.colour).toBe('FF0000')
  })

  it('releases every direct property through clear formatting', () => {
    const decorated = modelWithRuns([
      {
        id: 'r1',
        text: 'The Claimant',
        preservedXmlFragments: [
          '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:i/><w:u w:val="single"/><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/><w:sz w:val="28"/><w:color w:val="FF0000"/><w:smallCaps/></w:rPr>',
        ],
      },
    ])
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      decorated,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { kind: 'selection', ranges: [{ paragraphId: 'p1', from: 0, to: 4 }] },
    )
    toolbar.onClearFormatting()
    expect(format.emphasis).toEqual([
      {
        paragraphId: 'p1',
        from: 0,
        to: 4,
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        vertAlign: null,
        smallCaps: null,
      },
    ])
    const painted = formatControlState(
      formattedModel(decorated, format),
      format,
      'p1',
      [{ paragraphId: 'p1', from: 0, to: 4 }],
    )
    expect(painted).toMatchObject({
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      fontFamily: null,
      fontSize: null,
      colour: null,
      highlight: null,
      vertAlign: 'baseline',
    })
  })
})

describe('list and style hardening', () => {
  const twoParagraphs: DocumentModelWire = {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            styleId: 'Heading1',
            runs: [{ id: 'r1', text: 'One', preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          },
          {
            id: 'p2',
            runs: [{ id: 'r2', text: 'Two', preservedXmlFragments: [] }],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [
      {
        styleId: 'Heading1',
        sourceFragment:
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>',
      },
      {
        styleId: 'Quote',
        sourceFragment:
          '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>',
      },
    ],
    numbering: [
      {
        numberingId: '1',
        abstractNumberingId: '0',
        sourceFragment: '<w:num w:numId="1"/>',
        levels: [
          { ilvl: 0, numFmt: 'decimal' },
          { ilvl: 2, numFmt: 'lowerRoman' },
        ],
      },
      {
        numberingId: '2',
        abstractNumberingId: '0',
        sourceFragment: '<w:num w:numId="2"/>',
        levels: [{ ilvl: 0, numFmt: 'bullet' }],
      },
      {
        numberingId: '3',
        abstractNumberingId: '0',
        sourceFragment: '<w:num w:numId="3"/>',
        levels: [{ ilvl: 0, numFmt: 'decimal' }],
      },
    ],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }

  const first = twoParagraphs.stories[0]?.paragraphs[0]
  if (!first) throw new Error('test model paragraph is missing')

  it('defines a mixed style state for a multi-paragraph selection', () => {
    const singleRange = { paragraphId: 'p1', from: 0, to: 0 }
    const ranges = [singleRange, { paragraphId: 'p2', from: 0, to: 0 }]
    expect(
      formatControlState(twoParagraphs, emptyFormatDrafts, 'p1', [singleRange]),
    ).toMatchObject({
      paragraphStyleId: 'Heading1',
      paragraphStyleMixed: false,
    })
    expect(
      formatControlState(twoParagraphs, emptyFormatDrafts, 'p1', ranges),
    ).toMatchObject({ paragraphStyleId: '', paragraphStyleMixed: true })
  })

  it('reflects a pending insert style from the drafts', () => {
    const format: FormatDrafts = {
      ...emptyFormatDrafts,
      paragraphStyles: { ins_1: 'Quote' },
    }
    expect(
      formatControlState(twoParagraphs, format, 'ins_1', [
        { paragraphId: 'ins_1', from: 0, to: 0 },
      ]),
    ).toMatchObject({ paragraphStyleId: 'Quote', paragraphStyleMixed: false })
  })

  it('lists paragraph styles once in document order', () => {
    expect(
      paragraphStyleOptions({
        ...twoParagraphs,
        styles: [
          ...twoParagraphs.styles,
          {
            styleId: 'Emphasis',
            sourceFragment:
              '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>',
          },
          {
            styleId: 'Heading1',
            sourceFragment:
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>',
          },
        ],
      }),
    ).toEqual([
      { styleId: 'Heading1', name: 'Heading 1' },
      { styleId: 'Quote', name: 'Quote' },
    ])
  })

  it('clamps list indent and outdent to the levels the instance defines', () => {
    const indented = indentList(emptyFormatDrafts, twoParagraphs, first)
    // Levels 0 and 2 only: indent jumps to 2, never to an undefined 1.
    expect(indented.numbering.p1).toEqual({ numId: '1', ilvl: 2 })
    const outdented = outdentList(indented, twoParagraphs, first)
    expect(outdented.numbering.p1).toEqual({ numId: '1', ilvl: 0 })
    expect(outdentList(outdented, twoParagraphs, first).numbering.p1).toEqual({
      numId: null,
    })
  })

  it('leaves a dangling numbering definition alone', () => {
    const dangling: DocumentModelWire = {
      ...twoParagraphs,
      numbering: twoParagraphs.numbering.filter(
        (instance) => instance.numberingId !== '1',
      ),
    }
    expect(indentList(emptyFormatDrafts, dangling, first)).toBe(
      emptyFormatDrafts,
    )
    expect(outdentList(emptyFormatDrafts, dangling, first)).toBe(
      emptyFormatDrafts,
    )
    expect(restartList(emptyFormatDrafts, dangling, first)).toBe(
      emptyFormatDrafts,
    )
  })

  it('continues from the nearest valid list past a dangling one', () => {
    const story = twoParagraphs.stories[0]
    if (!story) throw new Error('test model story is missing')
    const danglingModel: DocumentModelWire = {
      ...twoParagraphs,
      stories: [
        {
          ...story,
          paragraphs: [
            first,
            {
              id: 'p2',
              runs: [{ id: 'r2', text: 'Two', preservedXmlFragments: [] }],
              preservedXmlFragments: [
                '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr>',
              ],
            },
            {
              id: 'p3',
              runs: [{ id: 'r3', text: 'Three', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
        },
      ],
    }
    const target = danglingModel.stories[0]?.paragraphs[2]
    if (!target) throw new Error('test target paragraph is missing')
    const continued = continueList(emptyFormatDrafts, danglingModel, target)
    expect(continued.numbering.p3).toEqual({ numId: '1', ilvl: 0 })
  })

  it('emits a start override on the numbering operation', () => {
    expect(
      collectFormatOperations(
        twoParagraphs,
        {
          ...emptyFormatDrafts,
          numbering: { p1: { numId: '1', ilvl: 0, startOverride: 1 } },
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_paragraph_numbering',
        paragraphId: 'p1',
        numId: '1',
        ilvl: 0,
        startOverride: 1,
      },
    ])
  })

  it('applies and reads a list restart through the toolbar', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const build = () =>
      documentFormatToolbar(
        formattedModel(twoParagraphs, format),
        format,
        'p1',
        (update) => {
          format = update(format)
        },
        { kind: 'caret', paragraphId: 'p1', from: 0, to: 0 },
      )
    expect(build().canRestart).toBe(true)
    expect(build().listRestarted).toBe(false)
    build().onRestartList()
    expect(format.numbering.p1).toEqual({
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })
    expect(build().listRestarted).toBe(true)
  })

  it('applies one list toggle across a multi-paragraph selection', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const ranges = [
      { paragraphId: 'p1', from: 0, to: 0 },
      { paragraphId: 'p2', from: 0, to: 0 },
    ]
    const build = () =>
      documentFormatToolbar(
        formattedModel(twoParagraphs, format),
        format,
        'p1',
        (update) => {
          format = update(format)
        },
        { kind: 'selection', ranges },
      )
    // p1 is multilevel and p2 is plain, so one click makes both the picked
    // decimal instance instead of adding to one and removing from the other.
    build().onToggleList('number')
    expect(format.numbering.p1).toEqual({ numId: '3', ilvl: 0 })
    expect(format.numbering.p2).toEqual({ numId: '3', ilvl: 0 })
    build().onToggleList('number')
    expect(format.numbering.p1).toEqual({ numId: null })
    expect(format.numbering.p2).toEqual({ numId: null })
  })

  it('paints a restart at the drafted number before any save', () => {
    const story = twoParagraphs.stories[0]
    if (!story) throw new Error('test model story is missing')
    const listedModel: DocumentModelWire = {
      ...twoParagraphs,
      stories: [
        {
          ...story,
          paragraphs: ['p1', 'p2', 'p3'].map((id) => ({
            id,
            runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          })),
        },
      ],
    }
    const before = documentListMarkers(
      formattedModel(listedModel, emptyFormatDrafts),
    )
    expect(before.get('p1')?.text).toBe('1.')
    expect(before.get('p2')?.text).toBe('2.')
    expect(before.get('p3')?.text).toBe('3.')

    const target = listedModel.stories[0]?.paragraphs[2]
    if (!target) throw new Error('test target paragraph is missing')
    const format = restartList(emptyFormatDrafts, listedModel, target)
    expect(format.numbering.p3).toEqual({
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })

    // The draft names the source, which the model does not carry an override
    // for, so the paint synthesises an instance and the marker restarts now.
    const after = documentListMarkers(formattedModel(listedModel, format))
    expect(after.get('p1')?.text).toBe('1.')
    expect(after.get('p2')?.text).toBe('2.')
    expect(after.get('p3')?.text).toBe('1.')
  })

  it('drafts an existing matching restart instance instead of the source', () => {
    const base = twoParagraphs.numbering[0]
    if (!base) throw new Error('test numbering instance is missing')
    const reusable: DocumentModelWire = {
      ...twoParagraphs,
      numbering: [
        base,
        {
          numberingId: '2',
          abstractNumberingId: '0',
          startOverride: 1,
          sourceFragment:
            '<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>',
          levels: [{ ilvl: 0, start: 1, numFmt: 'decimal' }],
        },
      ],
    }
    const format = restartList(emptyFormatDrafts, reusable, first)
    expect(format.numbering.p1).toEqual({
      numId: '2',
      ilvl: 0,
      startOverride: 1,
    })
    // The resolved instance already carries the override, so the paint does
    // not synthesise a second one.
    const painted = formattedModel(reusable, format)
    expect(painted.numbering.map((instance) => instance.numberingId)).toEqual([
      '1',
      '2',
    ])
    expect(documentListMarkers(painted).get('p1')?.text).toBe('1.')
  })

  it('paints one sequence for paragraphs restarted together', () => {
    const story = twoParagraphs.stories[0]
    if (!story) throw new Error('test model story is missing')
    const listed: DocumentModelWire = {
      ...twoParagraphs,
      stories: [
        {
          ...story,
          paragraphs: ['p1', 'p2', 'p3'].map((id) => ({
            id,
            runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          })),
        },
      ],
    }
    const [first, second, third] = listed.stories[0]?.paragraphs ?? []
    if (!first || !second || !third) {
      throw new Error('test target paragraphs are missing')
    }
    let format = restartList(emptyFormatDrafts, listed, second)
    format = restartList(format, listed, third)
    // Both drafts still name the source; the paint must synthesise one shared
    // instance, so the two restarted paragraphs count 1., 2. like the save.
    expect(format.numbering.p2).toEqual({
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })
    expect(format.numbering.p3).toEqual({
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })
    const markers = documentListMarkers(formattedModel(listed, format))
    expect(markers.get('p1')?.text).toBe('1.')
    expect(markers.get('p2')?.text).toBe('1.')
    expect(markers.get('p3')?.text).toBe('2.')
  })

  it('reads restart unpressed when only some numbered targets carry an override', () => {
    const story = twoParagraphs.stories[0]
    if (!story) throw new Error('test model story is missing')
    const bothNumbered: DocumentModelWire = {
      ...twoParagraphs,
      stories: [
        {
          ...story,
          paragraphs: ['p1', 'p2'].map((id) => ({
            id,
            runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          })),
        },
      ],
    }
    const [first, second] = bothNumbered.stories[0]?.paragraphs ?? []
    if (!first || !second) {
      throw new Error('test target paragraphs are missing')
    }
    const ranges = [
      { paragraphId: 'p1', from: 0, to: 0 },
      { paragraphId: 'p2', from: 0, to: 0 },
    ]
    let format = restartList(emptyFormatDrafts, bothNumbered, first)
    expect(
      formatControlState(bothNumbered, format, 'p1', ranges).listRestarted,
    ).toBe(false)
    format = restartList(format, bothNumbered, second)
    expect(
      formatControlState(bothNumbered, format, 'p1', ranges).listRestarted,
    ).toBe(true)
  })

  it('enables restart when any target paragraph is a list, not only the caret', () => {
    const ranges = [
      { paragraphId: 'p1', from: 0, to: 0 },
      { paragraphId: 'p2', from: 0, to: 0 },
    ]
    // The caret sits in the plain p2, but p1 is a valid numbered target, so
    // the control that would act on it must not be disabled.
    expect(
      formatControlState(twoParagraphs, emptyFormatDrafts, 'p2', ranges)
        .canRestart,
    ).toBe(true)
  })
})

describe('document-format-edits module size', () => {
  it('stays within the source line ceiling', () => {
    const files = [
      './document-format-edits.ts',
      './document-format-paint.ts',
      './document-format-controls.ts',
      './document-format-toolbar.ts',
      './document-format-types.ts',
      './document-paragraph-format.ts',
      './document-draft-paragraph-format.ts',
      './document-draft-store.ts',
      './document-draft-identity.ts',
      './document-history-caret.ts',
      './document-selection.ts',
      './document-range-edits.ts',
      './document-word-edits.ts',
      './components/document-workspace/model-view.tsx',
      './components/document-workspace/toolbar-emphasis-state.test.tsx',
      './components/document-workspace/toolbar-character-formatting.test.tsx',
      './components/document-workspace/toolbar-font-formatting.test.tsx',
      './components/document-workspace/toolbar-paragraph-formatting.test.tsx',
      './components/document-workspace/model-page-blocks.tsx',
      './components/document-workspace/model-paragraph.tsx',
      './components/document-workspace/model-run.tsx',
      './components/document-workspace/paragraph-editor.tsx',
      './components/document-workspace/paragraph-arrow.ts',
      './components/document-workspace/use-workspace-caret.ts',
      './components/document-workspace/use-workspace-drafts.ts',
      './components/document-workspace/docx-workspace.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        'utf8',
      )
      expect(source.split('\n').length, file).toBeLessThanOrEqual(500)
    }
  })
})

describe('draft range paint run ids', () => {
  it('gives each split part a distinct id', () => {
    const source = modelWithRuns([
      { id: 'r1', text: 'The Claimant seeks', preservedXmlFragments: boldXml },
    ])
    const paragraph = source.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('paragraph missing')
    const projected = projectRangeEmphasis(paragraph, [
      { paragraphId: 'p1', from: 4, to: 13, bold: false },
    ])
    const ids = projected.runs.map((run) => run.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('does not split an astral character when the range ends inside it', () => {
    const text = 'A\u{1f600}B'
    const paragraph = {
      id: 'p1',
      runs: [{ id: 'r1', text, preservedXmlFragments: [] as string[] }],
      preservedXmlFragments: [] as string[],
    }
    const projected = projectRangeEmphasis(paragraph, [
      { paragraphId: 'p1', from: 0, to: 2, bold: true },
    ])
    expect(projected.runs.map((run) => run.text).join('')).toBe(text)
    for (const run of projected.runs) {
      expect(unpairedSurrogate(run.text)).toBe(false)
    }
  })

  it('stores the snapped range so a save does not ask to cut the pair', () => {
    const astralModel: DocumentModelWire = {
      ...model,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: [
                {
                  id: 'r1',
                  text: 'Hi\u{1f600}',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ],
    }
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      astralModel,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { kind: 'selection', ranges: [{ paragraphId: 'p1', from: 0, to: 3 }] },
      false,
      { r1: 'Hi\u{1f600}!' },
    )
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([
      { paragraphId: 'p1', from: 0, to: 4, bold: true },
    ])
  })
})

function unpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}
