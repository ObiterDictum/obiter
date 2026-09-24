// A path reference is the only way to load an ambient declaration beside the
// importing file without publishing a types package.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./jsdom.d.ts" />
import { expect } from 'bun:test'
import { JSDOM } from 'jsdom'

/**
 * jsdom for DOM test files.
 *
 * Installed by scripts/test/dom-preload.ts before the test module's own
 * imports, when the file imports this package as its DOM marker. The preload
 * is the point that matters: bun evaluates bare specifiers before relative
 * ones and React/Testing Library cache `canUseDOM` and `document.body` at
 * their own module evaluation, so a per-file setup module can run too late.
 * The import in the test file is idempotent with that preload; it exists so a
 * file declares that it needs the DOM.
 *
 * The globals installed here are jsdom's, including `Event`/`EventTarget`,
 * which differ from the Node globals of the same name — a Node `Event`
 * dispatched at a jsdom target is rejected as "not of type 'Event'". Node's
 * runtime essentials (timers, fetch, crypto, MessageChannel) are kept: jsdom
 * either lacks them or its versions are not what code under test uses.
 */
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
  // React's scheduler posts through a MessageChannel; jsdom's does not drive
  // it the same way, so the host implementation stays.
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

async function install(): Promise<void> {
  if ((globalThis as Record<PropertyKey, unknown>)[installFlag] === true) return

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000',
    pretendToBeVisual: true,
  })
  const window = dom.window
  const source = window as unknown as Record<string, unknown>

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
    } catch {
      // A non-configurable host global; the host value stays.
    }
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
    } catch {
      // Already defined by the runtime with a compatible value.
    }
  }

  // @testing-library/dom evaluates `screen` against `document.body` at its
  // own module evaluation. Now that the document exists, rebind it: `screen`
  // is a plain object (the package re-exports the same one), so assigning
  // real queries over the stubs fixes the binding whatever the order.
  const testingLibrary = await import('@testing-library/dom')
  Object.assign(
    testingLibrary.screen as unknown as Record<string, unknown>,
    testingLibrary.getQueriesForElement(
      (globalThis as unknown as { document: { body: HTMLElement } }).document
        .body,
      testingLibrary.queries,
    ),
  )

  ;(globalThis as Record<PropertyKey, unknown>)[installFlag] = true
}

await install()

/**
 * A short description of a value for a failure message, bounded so formatting
 * stays cheap. jsdom nodes never reach the impl graph; other values are
 * inspected shallowly, since only `null` was expected anyway.
 */
function describeValue(value: unknown): string {
  if (typeof Node !== 'undefined' && value instanceof Node) {
    if (value.nodeType === 1) {
      const element = value as Element
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

/**
 * `toBeNull` with bun's exact pass rule (`received === null`) and a bounded
 * failure message. The built-in formats the received value eagerly, and for a
 * jsdom node that walk follows `[Symbol(impl)]` into `_globalObject`, the whole
 * Window: roughly 200ms for a detached element and seconds once the app is
 * mounted. Every `waitFor` poll that fails before the condition holds pays it,
 * so one negative-DOM wait could hold the file for seconds with no test
 * sleeping anywhere. The summary keeps the element identifiable: tag, id,
 * role, text, without traversing the graph.
 */
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
