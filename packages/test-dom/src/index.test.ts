import '@obiter/test-dom'
import { screen } from '@testing-library/dom'
import { expect, it } from 'bun:test'

const documentExistedAtModuleEvaluation = typeof document !== 'undefined'

it('installs the document before the test module evaluates', () => {
  expect(documentExistedAtModuleEvaluation).toBe(true)
  expect(typeof window).toBe('object')
  expect(document.body).not.toBeNull()
})

it('binds a live screen without the installer pre-importing it', () => {
  const probe = document.createElement('div')
  probe.textContent = 'screen binding probe'
  document.body.append(probe)
  expect(screen.getByText('screen binding probe')).toBe(probe)
  probe.remove()
})

it('keeps the Node runtime globals the DOM install must not replace', () => {
  expect(typeof fetch).toBe('function')
  expect(typeof queueMicrotask).toBe('function')
  expect(typeof structuredClone).toBe('function')
  expect(typeof MessageChannel).toBe('function')
  expect(typeof Buffer).toBe('function')
})

it('records the install so a second import cannot reinstall over the test globals', () => {
  const host = globalThis as unknown as Record<symbol, unknown>
  expect(host[Symbol.for('obiter.testDomInstalled')]).toBe(true)
})

it('installs jsdom Event so an event dispatched at a jsdom target is accepted', () => {
  const target = document.createElement('div')
  let seen = false
  target.addEventListener('probe', () => {
    seen = true
  })

  target.dispatchEvent(new Event('probe'))

  expect(seen).toBe(true)
  expect(new Event('probe') instanceof window.Event).toBe(true)
})

it('reports no media query match so shell components render without layout', () => {
  const query = window.matchMedia('(min-width: 900px)')

  expect(query.matches).toBe(false)
  expect(query.media).toBe('(min-width: 900px)')
})

it('passes toBeNull only for exactly null', () => {
  expect(null).toBeNull()
  expect(undefined).not.toBeNull()
})

it('summarises a jsdom element in a bounded failure message', () => {
  const element = document.createElement('div')
  element.id = 'probe'
  element.textContent = 'x'.repeat(500)

  let message = ''
  try {
    expect(element).toBeNull()
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  expect(message).toContain('<div#probe>')
  expect(message.length).toBeLessThan(200)
})
