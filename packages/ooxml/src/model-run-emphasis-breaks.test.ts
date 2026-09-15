import { describe, expect, it } from 'vitest'

import { applyDocumentEdits } from './index'
import {
  documentXml,
  flag,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

// E44 review finding 1: `effectiveView` counted every w:br child as a text
// newline while the parser counts only text-wrapping breaks, so a run mixing
// text with a page/column break (or a CRLF replacement) still rejected the
// composed save. Break classification has one owner now, and the replacement
// path consumes the run's own text-wrapping breaks so the model, the parser and
// the serialiser describe the same text.
const PAGE_BREAK = '<w:br w:type="page"/>'
const COLUMN_BREAK = '<w:br w:type="column"/>'

async function loadRun(runXml: string) {
  const document = await load(`<w:p>${runXml}</w:p>`)
  const paragraph = paragraphs(document)[0]
  const run = paragraph?.runs[0]
  if (!paragraph || !run) throw new Error('Fixture is missing.')
  return { document, paragraph, run }
}

function emphasised(
  paragraphRuns: ReadonlyArray<{
    text: string
    preservedXmlFragments: string[]
  }>,
) {
  return paragraphRuns
    .filter((item) => flag(item, 'b'))
    .map((item) => item.text)
}

function count(xml: string, fragment: string) {
  return xml.split(fragment).length - 1
}

describe('replacement composed with range emphasis across w:br', () => {
  it('keeps a page break, never consumes a text offset, and edits the text', async () => {
    const { document, paragraph, run } = await loadRun(
      `<w:r><w:t>ab</w:t>${PAGE_BREAK}<w:t>cd</w:t></w:r>`,
    )
    expect(run.text).toBe('abcd')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(xml).toContain(PAGE_BREAK)
    expect(count(xml, PAGE_BREAK)).toBe(1)
    expect(count(xml, '<w:br/>')).toBe(0)

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
    expect(emphasised(runs)).toEqual(['XYcd'])
  })

  it('keeps a column break and formats the text after it', async () => {
    const { document, paragraph, run } = await loadRun(
      `<w:r><w:t>ab</w:t>${COLUMN_BREAK}<w:t>cd</w:t></w:r>`,
    )

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, COLUMN_BREAK)).toBe(1)
    expect(count(xml, '<w:br/>')).toBe(0)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
    expect(emphasised(runs)).toEqual(['cd'])
  })

  it.each([
    ['page', PAGE_BREAK],
    ['column', COLUMN_BREAK],
  ])(
    'formats text before and after a structural %s break',
    async (_name, br) => {
      const { document, paragraph, run } = await loadRun(
        `<w:r><w:t>ab</w:t>${br}<w:t>cd</w:t></w:r>`,
      )

      applyDocumentEdits(document, [
        { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 0,
          to: 2,
          bold: true,
        },
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 4,
          to: 6,
          italic: true,
        },
      ])

      const xml = await documentXml(document)
      expect(count(xml, br)).toBe(1)
      const reparsed = await save(document)
      const runs = paragraphs(reparsed)[0]?.runs ?? []
      expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
      expect(emphasised(runs)).toEqual(['ab'])
      expect(
        runs.filter((item) => flag(item, 'i')).map((item) => item.text),
      ).toEqual(['cd'])
    },
  )

  it('keeps a structural break in place when only emphasis is applied', async () => {
    const { document, paragraph } = await loadRun(
      `<w:r><w:t>ab</w:t>${PAGE_BREAK}<w:t>cd</w:t></w:r>`,
    )

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
    expect(count(xml, PAGE_BREAK)).toBe(1)
    // Position preserved: the break stays between the two text elements.
    expect(xml).toContain(`${PAGE_BREAK}<w:t>cd</w:t>`)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abcd')
    expect(emphasised(runs)).toEqual(['cd'])
  })

  it('represents a non-text-wrapping break as a preserved fragment, not a newline', async () => {
    const { document, paragraph, run } = await loadRun(
      `<w:r><w:t>ab</w:t>${PAGE_BREAK}<w:t>cd</w:t></w:r>`,
    )
    expect(run.text).toBe('abcd')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 5,
        bold: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(
      runs.flatMap((item) => item.preservedXmlFragments).join(''),
    ).toContain('w:type="page"')
    expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
  })

  it('keeps a break of an unrecognised type as structural and consumes no offset', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>ab</w:t><w:br w:type="unsupported"/><w:t>cd</w:t></w:r>',
    )
    expect(run.text).toBe('abcd')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 6,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:br w:type="unsupported"/>')).toBe(1)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
    expect(emphasised(runs)).toEqual(['cd'])
  })

  it('is stable across repeated serialisation', async () => {
    const { document, paragraph, run } = await loadRun(
      `<w:r><w:t>ab</w:t>${PAGE_BREAK}<w:t>cd</w:t></w:r>`,
    )

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 5,
        bold: true,
      },
    ])

    const first = await documentXml(document)
    const again = await documentXml(await save(document))
    expect(again).toBe(first)
  })
})

describe('replacement text and text-wrapping breaks', () => {
  const TEXT_BREAK = '<w:r><w:t>ab</w:t><w:br/><w:t>cd</w:t></w:r>'

  it('removes a text-wrapping break the replacement does not carry', async () => {
    const { document, run } = await loadRun(TEXT_BREAK)

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:br/>')).toBe(0)
    const reparsed = await save(document)
    expect(
      (paragraphs(reparsed)[0]?.runs ?? []).map((item) => item.text).join(''),
    ).toBe('abXYcd')
  })

  it('carries a text-wrapping break exactly once when the replacement repeats it', async () => {
    const { document, run } = await loadRun(TEXT_BREAK)

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'ab\ncd' },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:br/>')).toBe(1)
    const reparsed = await save(document)
    expect(
      (paragraphs(reparsed)[0]?.runs ?? []).map((item) => item.text).join(''),
    ).toBe('ab\ncd')
  })

  it('formats text before a text-wrapping break', async () => {
    const { document, paragraph, run } = await loadRun(TEXT_BREAK)

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXY\ncd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 2,
        bold: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXY\ncd')
    expect(emphasised(runs)).toEqual(['ab'])
  })

  it('formats text after a retained text-wrapping break', async () => {
    const { document, paragraph, run } = await loadRun(TEXT_BREAK)

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abXY\ncd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 5,
        to: 7,
        bold: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXY\ncd')
    expect(emphasised(runs)).toEqual(['cd'])
  })

  it('normalises a CRLF replacement to one logical break', async () => {
    const { document, paragraph, run } = await loadRun(
      '<w:r><w:t>seed</w:t></w:r>',
    )

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'ab\r\nXYcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 2,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:br/>')).toBe(1)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('ab\nXYcd')
    expect(emphasised(runs)).toEqual(['ab'])
  })

  it('normalises a lone CR replacement to one logical break', async () => {
    const { document, run } = await loadRun('<w:r><w:t>seed</w:t></w:r>')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'ab\rXYcd' },
    ])

    const xml = await documentXml(document)
    expect(count(xml, '<w:br/>')).toBe(1)
    const reparsed = await save(document)
    expect(
      (paragraphs(reparsed)[0]?.runs ?? []).map((item) => item.text).join(''),
    ).toBe('ab\nXYcd')
  })
})
