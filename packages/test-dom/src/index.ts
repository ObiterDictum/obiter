// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./jsdom.d.ts" />
import { expect } from 'bun:test'
import { JSDOM } from 'jsdom'

const runtimeGlobals = new Set([
  'console',
  'process',
  'global',
  'globalThis',
  'Buffer',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'structuredClone',
  'fetch',
  'WebSocket',
  'crypto',
  'performance',
  'MessageChannel',
  'MessagePort',
  'AbortController',
  'AbortSignal',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'atob',
  'btoa',
])

const installFlag = Symbol.for('obiter.testDomInstalled')

// SAFETY: globalThis is a non-null object at runtime, so a string-keyed view only enables reads and writes the install loop already performs; the flag read below compares against `true` and the write stores `true`.
const hostGlobals = globalThis as Record<PropertyKey, unknown>

async function install(): Promise<void> {
  if (hostGlobals[installFlag] === true) return

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000',
    pretendToBeVisual: true,
  })
  const window = dom.window
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }

  // SAFETY: jsdom installs every DOM global (Node, Element, Document, Event) as an own property of its window, including non-enumerable ones, so the copy loop below must read through a string-keyed view; the intersection keeps the declared window type while only adding keyed reads, and values are copied verbatim.
  const source = window as typeof window & Record<string, unknown>

  for (const key of Object.getOwnPropertyNames(source)) {
    if (runtimeGlobals.has(key)) continue
    let value: unknown
    try {
      value = source[key]
    } catch {
      continue
    }
    if (value === undefined) continue
    try {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      })
    } catch {}
  }

  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    history: window.history,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  })) {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      })
    } catch {}
  }

  hostGlobals[installFlag] = true
}

await install()

function describeValue(value: unknown): string {
  if (typeof Node !== 'undefined' && value instanceof Node) {
    if (
      value.nodeType === 1 &&
      typeof Element !== 'undefined' &&
      value instanceof Element
    ) {
      const element = value
      const id = element.id ? `#${element.id}` : ''
      const role = element.getAttribute('role')
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80)
      const roleSuffix = role ? ` [role=${role}]` : ''
      return `<${element.tagName.toLowerCase()}${id}${roleSuffix}> ${JSON.stringify(text)}`
    }
    return `#node(nodeType=${value.nodeType})`
  }
  try {
    return Bun.inspect(value, { depth: 3, colors: false })
  } catch {
    return String(value)
  }
}

expect.extend({
  toBeNull(received: unknown) {
    const pass = received === null
    return {
      pass,
      message: () =>
        pass
          ? 'expected value not to be null, received null'
          : `expected null, received ${describeValue(received)}`,
    }
  },
})
