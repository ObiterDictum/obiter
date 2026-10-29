import { expect, it } from 'bun:test'

it('leaves files without the DOM marker in the node environment', () => {
  expect(typeof window).toBe('undefined')
  expect(typeof document).toBe('undefined')
})
