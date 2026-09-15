import { describe, expect, it } from 'vitest'

import { applyDocumentEdits, OoxmlError } from './index'
import {
  documentXml,
  flag,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

// E44 review finding 3: the coordinate space is a contract, not an incidental
// consequence of operation order. Every operation in a batch addresses the
// paragraph text after all replace_run_text operations in that batch.
describe('composed edit coordinate space', () => {
  it('addresses the final draft even when emphasis is listed first', async () => {
    const document = await load('<w:p><w:r><w:t>seed</w:t></w:r></w:p>')
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 6,
        bold: true,
      },
      { type: 'replace_run_text', runId: run.id, text: 'abXYcd' },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abXYcd')
    expect(
      runs.filter((item) => flag(item, 'b')).map((item) => item.text),
    ).toEqual(['XYcd'])
  })

  it('keeps the later operation as the per-property last write', async () => {
    const document = await load('<w:p><w:r><w:t>seed</w:t></w:r></w:p>')
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'abcd' },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 0,
        to: 4,
        bold: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 2,
        to: 4,
        bold: false,
      },
    ])

    const reparsed = await save(document)
    const runs = paragraphs(reparsed)[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('abcd')
    expect(
      runs.filter((item) => flag(item, 'b')).map((item) => item.text),
    ).toEqual(['ab'])
  })
})

// E44 review finding 4: materialiseRun deleted overlay keys as it folded,
// before the effective-text guard ran. Every caller discards the model on
// OoxmlError today, so the mutation is unobservable in production; this pins
// the structural invariant anyway by checking the model still serialises the
// pending replacement after a rejected apply. The rejection here is a
// surrogate-splitting range, validated after the replacement has been applied.
describe('overlay mutation on a rejected composed edit', () => {
  it('keeps the pending replacement when a split is rejected', async () => {
    const document = await load(
      '<w:p><w:r><w:t>ab</w:t><w:br/><w:br/><w:t>😀</w:t></w:r></w:p>',
    )
    const paragraph = paragraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'replace_run_text', runId: run.id, text: 'ab\n\n😀' },
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 3,
          to: 5,
          bold: true,
        },
      ]),
    ).toThrow(OoxmlError)

    expect(await documentXml(document)).toContain('😀')
    const reparsed = await save(document)
    expect(
      (paragraphs(reparsed)[0]?.runs ?? []).map((item) => item.text).join(''),
    ).toBe('ab\n\n😀')
  })
})
