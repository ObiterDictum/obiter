import { expect, test, type Locator, type Page } from '@playwright/test'
import { meResponseSchema } from '@obiter/contracts'

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
  ...(index === 54
    ? {
        headings: [{ kind: 'section', text: 'Interpretation of the contract' }],
      }
    : {}),
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

async function openSignedIn(page: Page, destination: string) {
  await page.goto(`/sign-in?redirect=${encodeURIComponent(destination)}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill('shell-test@obiter.test')
  await page.getByLabel('Password').fill('test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  const user = {
    id: 'licence-test-user',
    name: 'Example User',
    email: 'shell-test@obiter.test',
    emailVerified: true,
  }
  const me = meResponseSchema.parse({
    user: { ...user, role: 'owner' },
    organisation: {
      id: 'licence-test-org',
      name: 'Example Organisation',
      plan: 'private_beta',
    },
  })
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: { session: { id: 'licence-test-sign-in', userId: user.id }, user },
    }),
  )
  await page.route('**/api/me', (route) => route.fulfill({ json: me }))
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({ json: {} }),
  )
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
        pages: [{ page: 12, paragraphNumber: 55, offset: 20 }],
      },
    }),
  )
})

test('a linked judgment paragraph and backward keyboard focus clear both sticky licence notices', async ({
  page,
}) => {
  await openSignedIn(page, '/search?q=contract')
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
  await expect
    .poll(async () => (await notices.boundingBox())?.height)
    .toBeLessThan(80)
  await paragraph.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  )
  await expect(paragraph).toBeInViewport()
  await expect(notices).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => clearance(paragraph, notices))
    .toBeGreaterThanOrEqual(0)
})

test('short-pane destinations clear the scrollable notices and excerpts omit them', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'write', {
      value: async ([item]: ClipboardItem[]) => {
        const text = await (await item.getType('text/plain')).text()
        document.documentElement.setAttribute('data-copied-quote', text)
      },
    })
  })
  await page.setViewportSize({ width: 390, height: 500 })
  await openSignedIn(page, '/case/example-judgment#para-55')
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
  await expect(notices).toBeInViewport({ ratio: 1 })
  await expect(coverage).toBeInViewport({ ratio: 1 })
  await expect(acknowledgement).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() =>
      notices.evaluate((notice) => notice.scrollHeight - notice.clientHeight),
    )
    .toBeLessThanOrEqual(0)
  await expect(paragraph).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => clearance(paragraph, notices))
    .toBeGreaterThanOrEqual(0)

  const selected = await page.evaluate(() => {
    const first = document.querySelector('#para-54 [data-source-text]')
    if (!first) throw new Error('Missing source text for paragraph 54')
    const last = document.querySelector('#para-55 [data-source-text]')
    if (!last) throw new Error('Missing source text for paragraph 55')
    const selection = window.getSelection()
    if (!selection) throw new Error('Browser selection is unavailable')
    const range = document.createRange()
    range.setStartBefore(first)
    range.setEndAfter(last)
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })
  expect(selected).not.toMatch(/partially represents|Crown copyright/)
  await page.getByRole('button', { name: 'Copy quote with citation' }).click()
  const copied = page.locator('html')
  await expect(copied).toHaveAttribute(
    'data-copied-quote',
    /example contract\.[\s\S]*The appeal concerns/,
  )
  await expect(copied).not.toHaveAttribute(
    'data-copied-quote',
    /partially represents|Crown copyright/,
  )

  const goTo = page.getByRole('textbox', { name: 'Go to paragraph' })
  await goTo.fill('p. 12')
  await goTo.press('Enter')
  const pageMarker = page.locator('#page-12')
  await expect(pageMarker).toBeFocused()
  await expect(pageMarker).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => clearance(pageMarker, notices))
    .toBeGreaterThanOrEqual(0)

  await page.setViewportSize({ width: 390, height: 350 })
  await expect
    .poll(async () => (await notices.boundingBox())?.height)
    .toBeLessThan(120)
  await expect
    .poll(() =>
      notices.evaluate((notice) => notice.scrollHeight > notice.clientHeight),
    )
    .toBe(true)
  await expect(notices).toHaveAttribute('tabindex', '0')
  await page.getByRole('searchbox', { name: 'Search within case' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(notices).toBeFocused()

  const reader = page.locator('[data-shell-scroll]')
  const noticeScrollTop = await notices.evaluate((notice) => notice.scrollTop)
  const readerScrollTop = await reader.evaluate((element) => element.scrollTop)
  await page.keyboard.press('End')
  await expect
    .poll(() => notices.evaluate((notice) => notice.scrollTop))
    .toBeGreaterThan(noticeScrollTop)
  await expect(acknowledgement).toBeInViewport({ ratio: 1 })
  expect(await reader.evaluate((element) => element.scrollTop)).toBe(
    readerScrollTop,
  )
})
