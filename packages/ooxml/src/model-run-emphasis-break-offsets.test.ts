import { describe, expect, it } from 'vitest'

import { applyDocumentEdits, OoxmlError } from './index'
import {
  documentXml,
  flag,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

// E57: a text-wrapping `w:br` occupies one `\n` character in the paragraph
// model, so a range boundary after it must advance the source coordinate the
// same way. `locateInsideRun` used to walk `w:t` elements only, so every offset
// past a break was short by one per break and an emphasis landed on the wrong
// characters. A non-wrapping break is structure and consumes no offset.
const TEXT_BREAK = '<w:br/>'
const PAGE_BREAK = '<w:br w:type="page"/>'
const COLUMN_BREAK = '<w:br w:type="column"/>'

async function loadRun(runXml: string) {
  const document = await load(`<w:p>${runXml}</w:p>`)
  const paragraph = paragraphs(document)[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Fixture is missing.')
  return { document, paragraph, run }
}

function styled(
  runs: ReadonlyArray<{ text: string; preservedXmlFragments: string[] }>,
  name: string,
) {
  return runs.filter((run) => flag(run, name)).map((run) => run.text)
}

function count(xml: string, fragment: string) {
  return xml.split(fragment).length - 1
}

describe('range emphasis across a text-wrapping break', () => {
  it('formats exactly the characters after a break', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\ncdef')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(xml).not.toMatch(/<w:r\s*\/>|<w:r>\s*<\/w:r>/u)
    expect(count(xml, TEXT_BREAK)).toBe(1)

    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(styled(runs, 'bold')).toEqual(['de'])
  })

  it('does not drift across several text-wrapping breaks', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>cd</w:t>${TEXT_BREAK}<w:t>ef</w:t></w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\ncd\nef')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 3,
        to: 5,
        italic: true,
      },
    ])

    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncd\nef')
    expect(styled(runs, 'italic')).toEqual(['cd'])
  })

  it('formats the characters on both sides of a break', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 1,
        to: 5,
        underline: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, TEXT_BREAK)).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(styled(runs, 'underline')).toEqual(['b\ncd'])
  })

  it('formats text before a break at the start of a run', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('\ncdef')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 1,
        to: 3,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, TEXT_BREAK)).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('\ncdef')
    expect(styled(runs, 'bold')).toEqual(['cd'])
  })

  it('formats text before a break at the end of a run', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}</w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\n')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 2,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, TEXT_BREAK)).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\n')
    expect(styled(runs, 'bold')).toEqual(['ab'])
  })

  // Selecting only a line break styles the run that carries it, never the
  // neighbouring text. The break is one model character, so a range covering
  // exactly it is a supported, if unusual, edit.
  it('formats only the logical newline without touching neighbouring text', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 3,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, TEXT_BREAK)).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(styled(runs, 'bold')).toEqual(['\n'])
  })

  it('formats across a run boundary and a break in one range', async () => {
    const document = await load(
      `<w:p><w:r><w:t>ab</w:t></w:r><w:r><w:t>cd</w:t>${TEXT_BREAK}<w:t>ef</w:t></w:r></w:p>`,
    )
    const target = paragraphs(document)[0]
    if (!target) throw new Error('Fixture is missing.')
    expect(target.runs.map((run) => run.text).join('')).toBe('abcd\nef')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: target.id,
        from: 2,
        to: 6,
        bold: true,
      },
    ])

    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('abcd\nef')
    expect(styled(runs, 'bold').join('')).toBe('cd\ne')
  })

  it('formats text after a break without splitting a surrogate pair', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>😀cd</w:t></w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\n😀cd')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 5,
        to: 7,
        bold: true,
      },
    ])

    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\n😀cd')
    expect(styled(runs, 'bold')).toEqual(['cd'])
  })

  it.each([
    ['page', PAGE_BREAK],
    ['column', COLUMN_BREAK],
    ['unrecognised', '<w:br w:type="unsupported"/>'],
  ])(
    'treats a %s break as structure that consumes no offset',
    async (_name, br) => {
      const { document, paragraph } = await loadRun(
        `<w:r><w:t>ab</w:t>${br}<w:t>cdef</w:t></w:r>`,
      )
      expect(paragraph.runs.map((run) => run.text).join('')).toBe('abcdef')

      applyDocumentEdits(document, [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 2,
          to: 4,
          bold: true,
        },
      ])

      const xml = await documentXml(document)
      expect(count(xml, br)).toBe(1)
      expect(count(xml, '<w:br/>')).toBe(0)
      const runs = paragraphs(await save(document))[0]?.runs ?? []
      expect(runs.map((run) => run.text).join('')).toBe('abcdef')
      expect(styled(runs, 'bold')).toEqual(['cd'])
    },
  )

  it('keeps a preserved run child and a tab that consume no offset', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t><w:noBreakHyphen/><w:tab/>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )
    expect(paragraph.runs.map((run) => run.text).join('')).toBe('ab\ncdef')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:noBreakHyphen/>')).toBe(1)
    expect(count(xml, '<w:tab/>')).toBe(1)
    expect(count(xml, TEXT_BREAK)).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(styled(runs, 'bold')).toEqual(['de'])
  })

  it('keeps paragraph-level bookmarks around a split run', async () => {
    const document = await load(
      `<w:p><w:bookmarkStart w:id="1" w:name="target"/>` +
        `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>cdef</w:t></w:r>` +
        `<w:bookmarkEnd w:id="1"/></w:p>`,
    )
    const paragraph = paragraphs(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:bookmarkStart w:id="1" w:name="target"/>')).toBe(1)
    expect(count(xml, '<w:bookmarkEnd w:id="1"/>')).toBe(1)
    const runs = paragraphs(await save(document))[0]?.runs ?? []
    expect(runs.map((run) => run.text).join('')).toBe('ab\ncdef')
    expect(styled(runs, 'bold')).toEqual(['de'])
  })

  it('stays stable across a second save', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:rPr><w:i/></w:rPr><w:t>ab</w:t>${TEXT_BREAK}<w:t>cdef</w:t></w:r>`,
    )

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const first = await documentXml(document)
    const again = await documentXml(await save(document))
    expect(again).toBe(first)
  })

  it.each([
    ['an out-of-bounds range', 0, 100],
    ['a reversed range', 5, 2],
    ['an empty range', 3, 3],
    ['a surrogate-splitting range', 4, 6],
  ])('fails closed for %s', async (_name, from, to) => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${TEXT_BREAK}<w:t>😀cd</w:t></w:r>`,
    )

    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from,
          to,
          bold: true,
        },
      ]),
    ).toThrow(OoxmlError)
  })
})
