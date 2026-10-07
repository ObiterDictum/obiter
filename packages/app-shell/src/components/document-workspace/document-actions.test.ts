import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  documentRedactionRunsId,
  refocusCaretBeforeSave,
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

describe('refocusCaretBeforeSave', () => {
  function mount(saveHolder: string) {
    document.body.innerHTML = `
      <span data-save-control><button type="button"></button></span>
      <div data-paragraph-id="p1" aria-current="true"><textarea></textarea></div>
      ${saveHolder}`
    const button = document.querySelector('button')
    const field = document.querySelector('textarea')
    if (!button || !field) throw new Error('fixture incomplete')
    return { button, field }
  }

  it('returns focus to the caret field when the Save control holds it', () => {
    const { button, field } = mount('')
    button.focus()
    refocusCaretBeforeSave()
    expect(document.activeElement).toBe(field)
  })

  it('leaves focus untouched when another element holds it', () => {
    const { field } = mount('<input>')
    const input = document.querySelector('input')
    if (!input) throw new Error('fixture incomplete')
    input.focus()
    refocusCaretBeforeSave()
    expect(document.activeElement).toBe(input)
    expect(document.activeElement).not.toBe(field)
  })

  it('does nothing when no paragraph holds the caret', () => {
    document.body.innerHTML =
      '<span data-save-control><button type="button"></button></span>'
    const button = document.querySelector('button')
    if (!button) throw new Error('fixture incomplete')
    button.focus()
    refocusCaretBeforeSave()
    expect(document.activeElement).toBe(button)
  })
})
