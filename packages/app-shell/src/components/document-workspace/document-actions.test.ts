import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  documentRedactionRunsId,
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
