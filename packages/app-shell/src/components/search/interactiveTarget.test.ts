// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isInteractiveTarget } from './interactiveTarget'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('isInteractiveTarget', () => {
  let host: HTMLElement | null = null

  afterEach(() => {
    host?.remove()
    host = null
  })

  it('recognises each interactive control the result shortcuts must not steal', () => {
    host = mount(`
      <button id="button">Resubmit</button>
      <a id="anchor" href="/case/example">Example</a>
      <select id="select"><option>One</option></select>
      <input id="input" />
      <textarea id="textarea"></textarea>
      <div id="role-button" role="button" tabindex="0">Role button</div>
    `)

    for (const id of [
      'button',
      'anchor',
      'select',
      'input',
      'textarea',
      'role-button',
    ]) {
      expect(isInteractiveTarget(host.querySelector(`#${id}`))).toBe(true)
    }
  })

  it('recognises a nested descendant of an interactive control', () => {
    host = mount(`
      <button id="button"><span id="icon"><strong id="glyph">Go</strong></span></button>
      <a id="anchor" href="/case/example"><span id="label">Example</span></a>
    `)

    // A keydown inside a control often targets a nested span or icon, not
    // the control itself; the predicate must walk up to the control.
    expect(isInteractiveTarget(host.querySelector('#icon'))).toBe(true)
    expect(isInteractiveTarget(host.querySelector('#glyph'))).toBe(true)
    expect(isInteractiveTarget(host.querySelector('#label'))).toBe(true)
  })

  it('leaves the non-interactive result surface alone', () => {
    host = mount('<div id="surface"><p id="text">Results</p></div>')

    expect(isInteractiveTarget(host.querySelector('#surface'))).toBe(false)
    expect(isInteractiveTarget(host.querySelector('#text'))).toBe(false)
    expect(isInteractiveTarget(window)).toBe(false)
    expect(isInteractiveTarget(document)).toBe(false)
    expect(isInteractiveTarget(null)).toBe(false)
  })
})
