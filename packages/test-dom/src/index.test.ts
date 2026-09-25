import '@obiter/test-dom'
import { screen } from '@testing-library/dom'
import { expect, it } from 'bun:test'

// The preload installs the document before this module's imports evaluate, so
// Testing Library's own module evaluation — where `screen` binds against
// `document.body` — must already see it. The installer deliberately does not
// import or rebind Testing Library; this order is the guarantee it relies on.
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
  // The no-document stub throws a TypeError for every query; a screen bound
  // to the installed body resolves the element.
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
