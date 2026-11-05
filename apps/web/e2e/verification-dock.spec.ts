import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { WIDTHS, mockSession } from './shell-harness'

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/verification-dock-pdf.json', import.meta.url),
    'utf8',
  ),
) as {
  matter: { matter: unknown }
  documents: unknown
  document: unknown
  pdfView: unknown
}

async function mockPdfDocument(page: Page) {
  await mockSession(page)
  await page.route('**/api/matters', (route) =>
    route.fulfill({ json: { matters: [fixture.matter.matter] } }),
  )
  await page.route('**/api/matters/mtr_dock', (route) =>
    route.fulfill({ json: fixture.matter }),
  )
  await page.route('**/api/matters/mtr_dock/documents', (route) =>
    route.fulfill({ json: fixture.documents }),
  )
  await page.route('**/api/documents/doc_dock', (route) =>
    route.fulfill({ json: fixture.document }),
  )
  await page.route('**/api/documents/doc_dock/pdf-view**', (route) =>
    route.fulfill({ json: fixture.pdfView }),
  )
  await page.route('**/api/documents/doc_dock/verification-runs**', (route) =>
    route.fulfill({ json: { runs: [], nextCursor: null } }),
  )
  await page.route('**/api/documents/doc_dock/redaction-runs**', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/documents/doc_dock/opened', (route) =>
    route.fulfill({ status: 204 }),
  )
}

test('the Verify dock never puts its text under its buttons at any supported width', async ({
  page,
}) => {
  await mockPdfDocument(page)
  await page.goto('/search')
  const nav = page.getByRole('navigation', { name: 'Workspace' })
  await nav.getByRole('link', { name: 'Matters' }).first().click()
  await page
    .getByRole('main')
    .getByRole('link', { name: /Dock check/ })
    .click()
  await page
    .getByRole('link', { name: /claim-form-fused\.pdf/ })
    .first()
    .click()
  const dock = page.getByRole('region', { name: 'Verification' })
  await expect(dock.getByRole('button', { name: 'Run Verify' })).toBeVisible()

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(150)

    const layout = await dock.evaluate((section) => {
      const controls = section.querySelector('[data-verification-controls]')
      if (!controls) throw new Error('Verify controls are missing.')
      const box = controls.getBoundingClientRect()
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT)
      const covered: string[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (controls.contains(node) || !node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (
            rect.width > 0 &&
            rect.right > box.left &&
            rect.left < box.right &&
            rect.bottom > box.top &&
            rect.top < box.bottom
          ) {
            covered.push(node.textContent.trim())
            break
          }
        }
      }
      return {
        covered,
        scrollWidth: section.scrollWidth,
        clientWidth: section.clientWidth,
      }
    })

    expect(
      layout.covered,
      `text under the Verify buttons at ${width}px`,
    ).toEqual([])
    expect(
      layout.scrollWidth,
      `Verify dock scrolls sideways at ${width}px`,
    ).toBeLessThanOrEqual(layout.clientWidth)
  }
})
