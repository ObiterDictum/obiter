import { test, expect } from '@playwright/test'
import {
  asideWidth,
  clearWheelLog,
  documentWidths,
  gotoOtherMode,
  lastWheelPrevented,
  mockSession,
  modeNav,
  modeRail,
  observeWheel,
  parkPointer,
  resetRailScroll,
  scrollLeft,
  SCROLLING_WIDTHS,
  tabToRailRow,
} from './shell-harness'

/**
 * Pointer and keyboard reachability of the shell navigation.
 *
 * The narrow-viewport fix rests on two mechanisms that the layout spec cannot
 * see: a mouse reaching a clipped mode in the top mode bar, and keyboard focus
 * revealing a row of the left icon rail. Both are exercised with real input
 * (page.mouse.wheel, keyboard Tab) and measured from the rendered boxes, and
 * neither mocks the scrolling or focus behaviour under test.
 */
test('a vertical mouse wheel scrolls the mode rail and reaches the last mode', async ({
  page,
}) => {
  await mockSession(page)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  for (const width of SCROLLING_WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/search')
    await expect(modeNav(page)).toBeVisible()
    // The observation hook lives on the page, so it does not survive a load.
    await observeWheel(page)
    // The pointer starts on the rail's own column, which expands the left rail
    // at these widths: park it and let the layout settle before measuring.
    await parkPointer(page, width)

    const box = await modeRail(page).boundingBox()
    expect(box, `no mode rail rendered at ${width}px`).not.toBeNull()
    const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
    const scrollable = await modeRail(page).evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    )

    await resetRailScroll(page)
    await page.mouse.move(centre.x, centre.y)
    await clearWheelLog(page)
    await page.mouse.wheel(0, 200)

    if (scrollable) {
      // The defect: in Chromium a vertical wheel leaves an overflow-x container
      // to the page, and the hidden scrollbar left no pointer path either.
      expect(
        await scrollLeft(page),
        `a vertical wheel did not scroll the mode rail at ${width}px`,
      ).toBeGreaterThan(0)
      expect(
        await lastWheelPrevented(page),
        `the wheel also scrolled the page at ${width}px`,
      ).toBe(true)
    } else {
      expect(
        await lastWheelPrevented(page),
        `the rail consumed the wheel while it had nowhere to scroll at ${width}px`,
      ).toBe(false)
    }

    // A horizontal trackpad gesture stays with the browser. Native trackpad
    // scrolling cannot be driven from a synthesised wheel here, so this asserts
    // the property the rail owns: it never consumes a horizontal gesture.
    await resetRailScroll(page)
    await clearWheelLog(page)
    await page.mouse.wheel(160, 0)
    expect(
      await lastWheelPrevented(page),
      `the rail consumed a horizontal wheel at ${width}px`,
    ).toBe(false)

    // Scroll to the end with real wheel input, then click the last mode.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const atEnd = await modeRail(page).evaluate(
        (element) =>
          element.scrollLeft >= element.scrollWidth - element.clientWidth - 1,
      )
      if (atEnd) break
      await page.mouse.move(centre.x, centre.y)
      await page.mouse.wheel(0, 240)
    }

    const redact = modeNav(page).getByRole('link', { name: 'Redact' })
    const clipped = await redact.evaluate((element) => {
      const link = element.getBoundingClientRect()
      const rail = element
        .closest('nav')!
        .parentElement!.getBoundingClientRect()
      return link.left < rail.left - 1 || link.right > rail.right + 1
    })
    expect(
      clipped,
      `Redact is still clipped inside the rail after wheel scrolling at ${width}px`,
    ).toBe(false)

    await redact.click()
    await expect(redact).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveURL(/\/redact/)

    const widths = await documentWidths(page)
    expect(
      widths.scrollWidth,
      `wheeling the rail widened the document at ${width}px`,
    ).toBeLessThanOrEqual(widths.clientWidth)
  }
})

test('ctrl+wheel is left to the browser, not consumed by the mode rail', async ({
  page,
}) => {
  await mockSession(page)
  await page.setViewportSize({ width: 768, height: 800 })
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  const box = await modeRail(page).boundingBox()
  expect(box).not.toBeNull()
  await resetRailScroll(page)

  // Ctrl+wheel is zoom. It must not move the rail.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
    deltaX: 0,
    deltaY: -200,
    modifiers: 2,
  })
  await cdp.detach()

  expect(await scrollLeft(page)).toBe(0)
})

test('keyboard focus reveals rail items below and above the md breakpoint', async ({
  page,
}) => {
  await mockSession(page)

  for (const width of [320, 390, 767, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await gotoOtherMode(page)

    const aside = page.locator('aside')
    await parkPointer(page, width)
    const collapsed = await asideWidth(aside)
    expect(
      collapsed,
      `the rail was not collapsed before the keyboard reveal at ${width}px`,
    ).toBeLessThan(64)

    const focused = await tabToRailRow(page)
    expect(focused, `no rail row took focus at ${width}px`).not.toBeNull()

    // The reveal is a width transition: wait for it to settle before measuring
    // the focused row's box.
    await expect
      .poll(() => asideWidth(aside), {
        message: `the rail stayed collapsed under keyboard focus at ${width}px`,
      })
      .toBeGreaterThan(collapsed + 40)

    const state = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement
      const row = element.getBoundingClientRect()
      const aside = element.closest('aside')!.getBoundingClientRect()
      const doc = document.documentElement
      return {
        label: element.getAttribute('aria-label'),
        rowLeft: row.left,
        rowRight: row.right,
        asideLeft: aside.left,
        asideRight: aside.right,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      }
    })

    // The focused row must sit inside the rail with room for its 2px focus ring,
    // and the reveal must not widen the document.
    expect(
      state.rowLeft - state.asideLeft,
      `the focused row's focus ring is clipped on the left at ${width}px`,
    ).toBeGreaterThanOrEqual(2)
    expect(
      state.asideRight - state.rowRight,
      `the focused rail row (${state.label}) is clipped at ${width}px`,
    ).toBeGreaterThanOrEqual(2)
    expect(
      state.scrollWidth,
      `revealing the rail widened the document at ${width}px`,
    ).toBeLessThanOrEqual(state.clientWidth)

    // Real activation, then the reveal must collapse again.
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await expect.poll(() => asideWidth(aside)).toBeLessThan(collapsed + 40)
  }
})
