import { describe, expect, it } from 'bun:test'
import {
  judgmentCoverSchema,
  judgmentPageSchema,
  judgmentParagraphSchema,
} from './index'

describe('judgment structure contract', () => {
  const paragraph = { id: 'p1', paragraphNumber: 2, text: 'Overview.' }

  it('reads a paragraph stored before the structure fields', () => {
    expect(judgmentParagraphSchema.parse(paragraph)).toEqual(paragraph)
  })

  it('reads labels, levels, styles and headings', () => {
    expect(
      judgmentParagraphSchema.parse({
        ...paragraph,
        label: '(1)',
        level: 2,
        style: 'quote',
        headings: [{ kind: 'opinion', text: 'LORD REED:' }],
      }),
    ).toMatchObject({ label: '(1)', level: 2, style: 'quote' })
    expect(() =>
      judgmentParagraphSchema.parse({ ...paragraph, level: 0 }),
    ).toThrow()
    expect(() =>
      judgmentParagraphSchema.parse({
        ...paragraph,
        headings: [{ kind: 'chapter', text: 'x' }],
      }),
    ).toThrow()
  })

  it('reads the cover with parties and counsel rows', () => {
    const cover = judgmentCoverSchema.parse({
      lines: [
        { kind: 'citation', text: '[2021] UKSC 31' },
        {
          kind: 'title',
          text: 'A (Respondents) v B (Appellant)',
          parties: [{ name: 'A', role: 'Respondents' }, { name: 'B' }],
        },
      ],
      counsel: [['HMRC', 'Test Claimants']],
    })
    expect(cover.lines[1]?.parties?.[1]).toEqual({ name: 'B' })
    expect(() => judgmentCoverSchema.parse({ lines: [] })).toThrow()
  })

  it('keeps the entry a page starts in and still reads older page maps', () => {
    const page = { page: 4, paragraphNumber: 2, offset: 0 }
    expect(judgmentPageSchema.parse(page)).toEqual(page)
    expect(
      judgmentPageSchema.parse({ ...page, paragraphId: 'doc-p4' }).paragraphId,
    ).toBe('doc-p4')
  })
})
