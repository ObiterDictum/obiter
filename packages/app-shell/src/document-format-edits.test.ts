import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectFormatOperations,
  documentFormatToolbar,
  emphasisAddress,
  emptyFormatDrafts,
  formatControlState,
  formattedModel,
  indentList,
  mergeEmphasis,
  outdentList,
  type FormatDrafts,
} from './document-format-edits'
import { projectRangeEmphasis } from './document-format-paint'

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
  it('does not queue a range emphasis while track changes is on', () => {
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
    expect(toolbar.emphasisUnavailable).toMatch(
      /partial formatting is not yet recorded as a tracked change/i,
    )
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([])
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
      { emphasis: [], paragraphStyles: {}, numbering: {} },
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
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
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

describe('document-format-edits module size', () => {
  it('stays within the source line ceiling', () => {
    const files = [
      './document-format-edits.ts',
      './document-format-paint.ts',
      './document-format-controls.ts',
      './document-format-toolbar.ts',
      './document-format-types.ts',
      './document-draft-store.ts',
      './document-draft-identity.ts',
      './document-selection.ts',
      './document-range-edits.ts',
      './document-word-edits.ts',
      './components/document-workspace/model-view.tsx',
      './components/document-workspace/toolbar-emphasis-state.test.tsx',
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
