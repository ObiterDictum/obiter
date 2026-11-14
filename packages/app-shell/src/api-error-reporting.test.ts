import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { apiFetch } from './api'
import { startErrorReporting } from './error-reporting'
const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
it('reports API five hundreds but never four hundreds', async () => {
  let reports = 0
  const beacon = navigator.sendBeacon
  navigator.sendBeacon = () => {
    reports++
    return true
  }
  const stop = startErrorReporting('web', null, true)
  globalThis.fetch = Object.assign(
    async () => new Response('{}', { status: 400 }),
    { preconnect: original.preconnect },
  )
  await expect(apiFetch('/api/matters')).rejects.toThrow()
  window.dispatchEvent(new Event('pagehide'))
  expect(reports).toBe(0)
  globalThis.fetch = Object.assign(
    async () => new Response('{}', { status: 500 }),
    { preconnect: original.preconnect },
  )
  await expect(apiFetch('/api/matters')).rejects.toThrow()
  window.dispatchEvent(new Event('pagehide'))
  expect(reports).toBe(1)
  stop()
  navigator.sendBeacon = beacon
})
