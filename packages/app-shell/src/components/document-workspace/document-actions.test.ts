import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  documentRedactionRunsId,
  refocusCaret,
  refocusCaretBeforeFlight,
  revealDocumentRedactionRuns,
} from './document-actions'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('revealDocumentRedactionRuns', () => {
  it('moves focus to the document-level redaction region', () => {
    document.body.innerHTML = `<section id="${documentRedactionRunsId}" tabindex="-1"><button>Redact this document</button></section>`
    const region = document.getElementById(documentRedactionRunsId)
    revealDocumentRedactionRuns()
    expect(document.activeElement).toBe(region)
  })

  it('does nothing when the region is absent', () => {
    document.body.innerHTML = '<div></div>'
    expect(() => revealDocumentRedactionRuns()).not.toThrow()
  })
})

describe('refocusCaretBeforeFlight', () => {
  function mount(extra: string) {
    document.body.innerHTML = `
      <button type="button" id="control"></button>
      <div data-paragraph-id="p1" aria-current="true"><textarea id="caret"></textarea></div>
      ${extra}`
    const button = document.getElementById('control')
    const field = document.getElementById('caret')
    if (!(button instanceof HTMLElement) || !(field instanceof HTMLElement))
      throw new Error('fixture incomplete')
    return { button, field }
  }

  it('hands a focused button back to the caret field without any marker', () => {
    const { button, field } = mount('')
    button.focus()
    refocusCaretBeforeFlight()
    expect(document.activeElement).toBe(field)
  })

  it('leaves focus in a field that still consumes typed text', () => {
    mount('<input id="find">')
    const input = document.getElementById('find')
    if (!(input instanceof HTMLElement)) throw new Error('fixture incomplete')
    input.focus()
    refocusCaretBeforeFlight()
    expect(document.activeElement).toBe(input)
  })

  it('leaves focus inside an open dialog', () => {
    mount(
      '<div role="dialog"><button type="button" id="confirm"></button></div>',
    )
    const confirm = document.getElementById('confirm')
    if (!(confirm instanceof HTMLElement)) throw new Error('fixture incomplete')
    confirm.focus()
    refocusCaretBeforeFlight()
    expect(document.activeElement).toBe(confirm)
  })

  it('does nothing when no paragraph holds the caret', () => {
    document.body.innerHTML = '<button type="button" id="control"></button>'
    const button = document.getElementById('control')
    if (!(button instanceof HTMLElement)) throw new Error('fixture incomplete')
    button.focus()
    refocusCaretBeforeFlight()
    expect(document.activeElement).toBe(button)
  })
})

describe('refocusCaret', () => {
  it('moves focus to the caret field even from a text field', () => {
    document.body.innerHTML = `
      <input id="comment">
      <div data-paragraph-id="p1" aria-current="true"><textarea id="caret"></textarea></div>`
    const input = document.getElementById('comment')
    const field = document.getElementById('caret')
    if (!(input instanceof HTMLElement) || !(field instanceof HTMLElement))
      throw new Error('fixture incomplete')
    input.focus()
    refocusCaret()
    expect(document.activeElement).toBe(field)
  })
})
