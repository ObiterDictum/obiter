import { describe, expect, it } from 'vitest'

import { applyDocumentEdits } from './index'
import {
  FLAG_VALUE,
  documentXml,
  flag,
  fragments,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

// E44: a run whose text is replaced in the same batch as a range emphasis on
// that new text. The range address and the replacement text share one
// coordinate space (the paragraph text after the replacement), so applying
// the split against the run's pre-replacement source mapping threw
// `comment-anchor-unresolved` from run-split bookkeeping even with no comments.
describe('composing run text replacement with range emphasis', () => {
  it('keeps the typed tail and underlines only the selected text', async () => {
    const document = await load(
      '<w:p><w:r><w:t>Intro</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve"> and plain tail.</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[1]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: run.id,
        text: ' and plain tail. tailword',
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 22,
        to: 30,
        underline: true,
      },
    ])

    const xml = await documentXml(document)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe(
      'Intro and plain tail. tailword',
    )
    const covered = runs.filter((item) => flag(item, 'u'))
    expect(covered.map((item) => item.text)).toEqual(['tailword'])
    expect(xml.match(/tailword/gu)).toHaveLength(1)
    expect(xml).not.toContain('comment-anchor')
  })

  it.each(['bold', 'italic', 'underline'] as const)(
    'applies %s to the inserted range only',
    async (flagName) => {
      const document = await load(
        '<w:p><w:r><w:t>one two three</w:t></w:r></w:p>',
      )
      const paragraph = paragraphs(document)[0]
      const run = paragraph?.runs[0]
      if (!paragraph || !run) throw new Error('Fixture is missing.')

      applyDocumentEdits(document, [
        {
          type: 'replace_run_text',
          runId: run.id,
          text: 'one two three four',
        },
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 14,
          to: 18,
          ...FLAG_VALUE[flagName],
        },
      ])

      const reparsed = await save(document)
      const runs = paragraphs(reparsed)[0]?.runs ?? []
      expect(runs.map((item) => item.text).join('')).toBe('one two three four')
      expect(
        runs.filter((item) => flag(item, flagName)).map((item) => item.text),
      ).toEqual(['four'])
    },
  )

  it('emphasises a range in the middle of the inserted text', async () => {
    const document = await load('<w:p><w:r><w:t>seed</w:t></w:r></w:p>')
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: run.id,
        text: 'alpha beta gamma',
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 6,
        to: 10,
        bold: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('alpha beta gamma')
    expect(runs.filter((item) => flag(item, 'b')).map((t) => t.text)).toEqual([
      'beta',
    ])
  })

  it('spans an original run and the inserted text in one range', async () => {
    const document = await load(
      '<w:p><w:r><w:t>AB</w:t></w:r><w:r><w:t>CD</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[1]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'CDEF' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 1,
        to: 4,
        italic: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('ABCDEF')
    expect(
      runs.filter((item) => flag(item, 'i')).map((entry) => entry.text),
    ).toEqual(['B', 'CD'])
  })

  it('keeps a whole-run emphasis alongside a range emphasis in one batch', async () => {
    const document = await load(
      '<w:p><w:r><w:t>one two three</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 7,
        underline: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('one two three')
    expect(runs.every((item) => flag(item, 'b'))).toBe(true)
    expect(runs.filter((item) => flag(item, 'u')).map((t) => t.text)).toEqual([
      'two',
    ])
  })

  it('applies every range in a batch instead of letting the last overwrite', async () => {
    const document = await load(
      '<w:p><w:r><w:t>one two three four</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 3,
        bold: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 8,
        to: 13,
        underline: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('one two three four')
    expect(runs.filter((item) => flag(item, 'b')).map((t) => t.text)).toEqual([
      'one',
    ])
    expect(runs.filter((item) => flag(item, 'u')).map((t) => t.text)).toEqual([
      'three',
    ])
  })

  it('resolves overlapping ranges to the later operation', async () => {
    const document = await load(
      '<w:p><w:r><w:t>one two three</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 6,
        bold: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 3,
        to: 7,
        bold: false,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('one two three')
    const bold = runs
      .filter((item) => flag(item, 'b'))
      .map((entry) => entry.text)
    expect(bold).toEqual(['one'])
    expect(runs.some((item) => /<w:b w:val="0"/u.test(fragments(item)))).toBe(
      true,
    )
  })

  it('preserves comment range markers around and inside the edited range', async () => {
    const document = await load(
      '<w:p><w:commentRangeStart w:id="0"/>' +
        '<w:r><w:t>bold me</w:t></w:r>' +
        '<w:commentRangeEnd w:id="0"/>' +
        '<w:r><w:commentReference w:id="0"/></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'bold me and more' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 8,
        to: 12,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(xml).toContain('<w:commentRangeStart w:id="0"/>')
    expect(xml).toContain('<w:commentRangeEnd w:id="0"/>')
    expect(xml).toContain('<w:commentReference w:id="0"/>')
    expect(xml.match(/commentRangeStart/gu)).toHaveLength(1)
    expect(runs.map((item) => item.text).join('')).toBe('bold me and more')
  })

  it('handles non-BMP and combining characters without splitting them', async () => {
    const document = await load('<w:p><w:r><w:t>seed</w:t></w:r></w:p>')
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'a\u{1F600}b\u0301' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 1,
        to: 3,
        underline: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 3,
        to: 5,
        italic: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('a\u{1F600}b\u0301')
    expect(runs.filter((item) => flag(item, 'u')).map((t) => t.text)).toEqual([
      '\u{1F600}',
    ])
    expect(runs.filter((item) => flag(item, 'i')).map((t) => t.text)).toEqual([
      'b\u0301',
    ])
  })

  it('keeps deterministic, unique run ids across a split', async () => {
    const document = await load(
      '<w:p><w:r><w:t>one two three</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'one two three four' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 4,
        to: 7,
        bold: true,
      },
    ])

    const reparsed = await save(document)
    const ids = (paragraphs(reparsed)[0]?.runs ?? []).map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(run.id)
  })

  it('preserves adjacent run formatting and escapes replacement text', async () => {
    const document = await load(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Lead</w:t></w:r>' +
        '<w:r><w:t>old</w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>Trail</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[1]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: ' <new & text> ' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 6,
        to: 9,
        underline: true,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe(
      'Lead <new & text> Trail',
    )
    expect(flag(runs[0], 'b')).toBe(true)
    expect(flag(runs[runs.length - 1], 'i')).toBe(true)
  })

  it('applies edits to multiple paragraphs in one request', async () => {
    const document = await load(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>second</w:t></w:r></w:p>',
    )
    const [first, second] = paragraphs(document)
    if (!first || !second || !first.runs[0] || !second.runs[0]) {
      throw new Error('Fixture is missing.')
    }

    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: first.runs[0].id,
        text: 'first edited',
      },
      {
        type: 'replace_run_text',
        runId: second.runs[0].id,
        text: 'second edited',
      },
      {
        type: 'set_run_emphasis',
        paragraphId: first.id,
        from: 6,
        to: 12,
        bold: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: second.id,
        from: 7,
        to: 13,
        underline: true,
      },
    ])

    const reparsed = await save(document)
    const edited = paragraphs(reparsed)
    expect(edited[0]?.runs.map((item) => item.text).join('')).toBe(
      'first edited',
    )
    expect(edited[1]?.runs.map((item) => item.text).join('')).toBe(
      'second edited',
    )
    expect(
      edited[0]?.runs.filter((item) => flag(item, 'b')).map((t) => t.text),
    ).toEqual(['edited'])
    expect(
      edited[1]?.runs.filter((item) => flag(item, 'u')).map((t) => t.text),
    ).toEqual(['edited'])
  })

  it('preserves structural children on a replaced run', async () => {
    const document = await load(
      '<w:p><w:r><w:tab/><w:drawing/><w:t>hi</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'hi there' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 3,
        to: 8,
        bold: true,
      },
    ])

    const xml = await documentXml(document)
    expect(xml.match(/<w:tab\/>/gu)).toHaveLength(1)
    expect(xml.match(/<w:drawing\/>/gu)).toHaveLength(1)
    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('hi there')
    expect(runs.filter((item) => flag(item, 'b')).map((t) => t.text)).toEqual([
      'there',
    ])
  })

  it('is idempotent when the same emphasis is applied after a reload', async () => {
    const document = await load(
      '<w:p><w:r><w:t>one two three</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'one two three four' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 14,
        to: 18,
        underline: true,
      },
    ])
    const saved = await save(document)
    const firstPass = (paragraphs(saved)[0]?.runs ?? []).map(
      (item) => item.text,
    )
    const reloaded = await save(saved)
    expect(
      (paragraphs(reloaded)[0]?.runs ?? []).map((item) => item.text),
    ).toEqual(firstPass)
    expect(
      paragraphs(reloaded)[0]
        ?.runs.map((item) => item.text)
        .join(''),
    ).toBe('one two three four')
  })
})
