import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { JudgmentPageText } from './JudgmentPageText'
import {
  judgmentAnnotations,
  judgmentCitationTarget,
  judgmentImageUrl,
} from './judgment-annotations'

afterEach(cleanup)

const paragraph = {
  id: 'p1',
  paragraphNumber: 1,
  text: 'Alpha Beta Gamma',
  footnotes: [{ offset: 5, marker: '1', text: 'Separate note' }],
  images: [{ offset: 10, src: 'image1.png' }],
  citations: [
    {
      offset: 0,
      length: 5,
      type: 'case' as const,
      href: 'https://caselaw.nationalarchives.gov.uk/ewca/civ/2020/1292',
    },
  ],
}

it('interleaves page labels, notes, images and citation spans without changing source text', async () => {
  const component = () => (
    <JudgmentPageText
      text={paragraph.text}
      paragraph={paragraph}
      query=""
      at={0}
      sourceUrl="https://caselaw.nationalarchives.gov.uk/ewhc/pat/2021/1377"
      pages={[{ at: 0, page: 1, paragraphNumber: 1, offset: 7 }]}
    />
  )
  const router = createRouter({
    routeTree: createRootRoute({ component }),
    history: createMemoryHistory(),
  })
  await router.load()
  const { container } = render(<RouterProvider router={router} />)
  expect(
    Array.from(container.querySelectorAll('[data-source-text]'))
      .map((n) => n.textContent)
      .join(''),
  ).toBe(paragraph.text)
  expect(container.querySelector('summary')?.getAttribute('aria-label')).toBe(
    'Footnote 1',
  )
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'https://assets.caselaw.nationalarchives.gov.uk/ewhc/pat/2021/1377/image1.png',
  )
  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    '/cases/ewca-civ-2020-1292',
  )
  expect(container.querySelector('[data-page-marker]')?.textContent).toBe(
    'Page 1p. 1',
  )
})

it('keeps the outer citation and discards nested and out-of-range annotations', () => {
  const result = judgmentAnnotations(paragraph.text, {
    ...paragraph,
    footnotes: [{ offset: 90, marker: '2', text: 'Invalid' }],
    images: [{ offset: -1, src: 'bad.png' }],
    citations: [
      { offset: 1, length: 2, type: 'case' },
      { offset: 0, length: 5, type: 'case' },
      { offset: 14, length: 10, type: 'case' },
    ],
  })
  expect(result.citations).toEqual([{ offset: 0, length: 5, type: 'case' }])
  expect(result.footnotes).toEqual([])
  expect(result.images).toEqual([])
})

it('refuses image sources outside the judgment host and non-bare filenames', () => {
  expect(
    judgmentImageUrl('https://example.com/ewca/1', 'image.png'),
  ).toBeUndefined()
  expect(
    judgmentImageUrl(
      'https://caselaw.nationalarchives.gov.uk/ewca/1',
      '../image.png',
    ),
  ).toBeUndefined()
  expect(judgmentImageUrl(undefined, 'image.png')).toBeUndefined()
})

it('routes supported legislation internally and refuses unsafe citation links', () => {
  expect(
    judgmentCitationTarget({
      offset: 0,
      length: 1,
      type: 'legislation',
      href: 'https://www.legislation.gov.uk/ukpga/1971/77',
    }),
  ).toBe('/ln/ukpga/1971/77')
  expect(
    judgmentCitationTarget({
      offset: 0,
      length: 1,
      type: 'case',
      canonical: 'A v B',
    }),
  ).toBeUndefined()
  expect(
    judgmentCitationTarget({
      offset: 0,
      length: 1,
      type: 'case',
      href: 'https://example.com/x',
    }),
  ).toBeUndefined()
})

it('accepts optional annotation fields and distinguishes printed and physical pages', async () => {
  const { judgmentParagraphSchema, judgmentPageSchema } =
    await import('@obiter/contracts')
  expect(judgmentParagraphSchema.parse(paragraph).footnotes?.[0]?.text).toBe(
    'Separate note',
  )
  expect(
    judgmentPageSchema.parse({
      page: 1,
      pdfPage: 2,
      paragraphNumber: 1,
      offset: 0,
    }),
  ).toEqual({ page: 1, pdfPage: 2, paragraphNumber: 1, offset: 0 })
  expect(
    judgmentParagraphSchema.safeParse({ ...paragraph, footnotes: [] }).success,
  ).toBe(false)
  expect(
    judgmentParagraphSchema.safeParse({
      ...paragraph,
      images: [{ offset: 0, src: '../image.png' }],
    }).success,
  ).toBe(false)
  expect(
    judgmentPageSchema.safeParse({
      page: 1,
      pdfPage: 0,
      paragraphNumber: 1,
      offset: 0,
    }).success,
  ).toBe(false)
})
