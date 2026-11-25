import { expect, test, type Locator } from '@playwright/test'
import { mockSession } from './shell-harness'

const judgment = {
  id: 'example-judgment',
  title: 'Example Appellant v Example Respondent',
  neutralCitation: null,
  court: 'uksc',
  dateDecided: '2026-07-22',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2026/99999',
}
const paragraphs = Array.from({ length: 80 }, (_, index) => ({
  id: `p${index + 1}`,
  paragraphNumber: index + 1,
  text: 'The appeal concerns the interpretation of an example contract.',
}))

async function clearance(target: Locator, notices: Locator) {
  const targetBox = await target.boundingBox()
  const noticesBox = await notices.boundingBox()
  return targetBox && noticesBox
    ? targetBox.y - (noticesBox.y + noticesBox.height)
    : Number.NEGATIVE_INFINITY
}

test('a linked judgment paragraph and backward keyboard focus clear both sticky licence notices', async ({
  page,
}) => {
  await mockSession(page)
  await page.route('**/api/search/legislation/acts', (route) =>
    route.fulfill({ json: { acts: [] } }),
  )
  await page.route('**/api/documents/citation-targets', (route) =>
    route.fulfill({ json: { documents: [] } }),
  )
  await page.route('**/api/search/fetch', (route) =>
    route.fulfill({
      json: {
        hits: [
          {
            ...judgment,
            canonicalUrl: `/case/${judgment.id}`,
            matchReason: 'body_text_match',
            snippets: [{ ...paragraphs[54], matchedTerms: ['contract'] }],
          },
        ],
        cached: true,
        indexedCount: 0,
        skippedCount: 0,
      },
    }),
  )
  await page.route(`**/api/search/documents/${judgment.id}`, (route) =>
    route.fulfill({
      json: {
        document: { ...judgment, paragraphs },
        courtParagraphNumbers: true,
      },
    }),
  )

  await page.goto('/search?q=contract')
  await page.getByRole('link', { name: 'Open paragraph' }).click()
  await expect(page).toHaveURL(/\/case\/example-judgment#para-55$/)

  const paragraph = page.locator('#para-55')
  const notices = page.getByRole('complementary', {
    name: 'Find Case Law licence notices',
  })
  const coverage = notices.getByText(
    'This material only partially represents court and tribunal activity. Find Case Law does not contain every judgment or decision.',
    { exact: true },
  )
  const acknowledgement = notices.getByText(
    'Crown copyright material reproduced by permission of The National Archives. The contents of the judgment can be used under the Open Justice - Licence.',
    { exact: true },
  )

  await expect(paragraph).toBeFocused()
  await expect(paragraph).toBeInViewport({ ratio: 1 })
  await expect(coverage).toBeInViewport({ ratio: 1 })
  await expect(acknowledgement).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => clearance(paragraph, notices))
    .toBeGreaterThanOrEqual(0)

  await page.keyboard.press('Shift+Tab')
  const previousAction = page.getByRole('button', {
    name: 'Paragraph 54 actions',
  })
  await expect(previousAction).toBeFocused()
  await expect(previousAction).toBeInViewport({ ratio: 1 })
  await expect(coverage).toBeInViewport({ ratio: 1 })
  await expect(acknowledgement).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => clearance(previousAction, notices))
    .toBeGreaterThanOrEqual(0)
})
