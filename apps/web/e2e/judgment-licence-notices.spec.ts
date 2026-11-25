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
const coverageText =
  'This material only partially represents court and tribunal activity. Find Case Law does not contain every judgment or decision.'
const acknowledgementText =
  'Crown copyright material reproduced by permission of The National Archives. The contents of the judgment can be used under the Open Justice - Licence.'

async function clearance(target: Locator, notices: Locator) {
  const targetBox = await target.boundingBox()
  const noticesBox = await notices.boundingBox()
  return targetBox && noticesBox
    ? targetBox.y - (noticesBox.y + noticesBox.height)
    : Number.NEGATIVE_INFINITY
}

test.beforeEach(async ({ page }) => {
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
})

test('a linked judgment paragraph and backward keyboard focus clear both sticky licence notices', async ({
  page,
}) => {
  await page.goto('/search?q=contract')
  await page.getByRole('link', { name: 'Open paragraph' }).click()
  await expect(page).toHaveURL(/\/case\/example-judgment#para-55$/)

  const paragraph = page.locator('#para-55')
  const notices = page.getByRole('complementary', {
    name: 'Find Case Law licence notices',
  })
  const coverage = notices.getByText(coverageText, { exact: true })
  const acknowledgement = notices.getByText(acknowledgementText, {
    exact: true,
  })

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

  await page.setViewportSize({ width: 320, height: 230 })
  await paragraph.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  )
  await expect(paragraph).toBeInViewport()
  await expect(notices).not.toBeInViewport()
})

test('in a short narrow pane the linked paragraph opens with both full notices inline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 350 })
  await page.goto('/search?q=contract')
  await page.getByRole('link', { name: 'Open paragraph' }).click()
  await expect(page).toHaveURL(/\/case\/example-judgment#para-55$/)

  const paragraph = page.locator('#para-55')
  const notices = page.locator('[data-judgment-arrival-notices]')
  await expect(paragraph).toBeFocused()
  await expect(notices.getByText(coverageText, { exact: true })).toBeInViewport(
    { ratio: 1 },
  )
  await expect(
    notices.getByText(acknowledgementText, { exact: true }),
  ).toBeInViewport({ ratio: 1 })
  await expect(paragraph).toBeInViewport()
  await expect
    .poll(() => clearance(paragraph, notices))
    .toBeGreaterThanOrEqual(0)
})
