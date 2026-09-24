/**
 * The slice of the jsdom API @obiter/test-dom uses. jsdom ships no types of
 * its own, and @types/jsdom would drag a second undici-types major into
 * programs that already conflict on fetch globals — so the two classes we
 * touch are declared here instead.
 */
declare module 'jsdom' {
  interface JSDOMLikeWindow {
    document: {
      body: HTMLElement
      createElement(tag: string): HTMLElement
    }
    navigator: object
    location: object
    history: object
    getComputedStyle(element: Element): object
    requestAnimationFrame(callback: (time: number) => void): number
    cancelAnimationFrame(handle: number): void
  }
  export class JSDOM {
    constructor(
      html?: string,
      options?: { url?: string; pretendToBeVisual?: boolean },
    )
    readonly window: JSDOMLikeWindow
  }
}
