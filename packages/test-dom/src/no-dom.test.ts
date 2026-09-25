import { expect, it } from 'bun:test'

// Same `dom-preload` as the DOM test file in this package: without importing
// the test-dom marker, the gate must leave the file in the node environment.
// (The gate is a raw substring check, so even this comment must not name the
// marker package literally.)
it('leaves files without the DOM marker in the node environment', () => {
  expect(typeof window).toBe('undefined')
  expect(typeof document).toBe('undefined')
})
