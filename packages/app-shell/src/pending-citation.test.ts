import '@obiter/test-dom'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  clearPendingCitation,
  readPendingCitation,
  requestCitation,
} from './pending-citation'

/**
 * The handoff from a source page to the document it will be typed into. It is
 * per document and per tab: a request for one document is invisible to another,
 * and answering it removes it rather than leaving a bar to reappear later.
 */
beforeEach(() => {
  window.sessionStorage.clear()
})

describe('pending citation handoff', () => {
  it('is readable only by the document it was left for', () => {
    requestCitation('doc_1', 'Wood v Capita [2017] UKSC 24')
    expect(readPendingCitation('doc_1')?.text).toBe(
      'Wood v Capita [2017] UKSC 24',
    )
    expect(readPendingCitation('doc_2')).toBeNull()
  })

  it('is dropped once it has been answered', () => {
    requestCitation('doc_1', 'Equality Act 2010, s. 13(3)')
    clearPendingCitation('doc_1')
    expect(readPendingCitation('doc_1')).toBeNull()
  })

  it('treats a stored value that names another document as no request', () => {
    window.sessionStorage.setItem(
      'obiter.pending-citation.v1.doc_1',
      JSON.stringify({
        documentId: 'doc_2',
        requestId: 'req_1',
        text: 'Misdirected',
      }),
    )
    expect(readPendingCitation('doc_1')).toBeNull()
  })

  it('gives a repeat request for the same text a new identity', () => {
    const first = requestCitation('doc_1', 'Same citation')
    const second = requestCitation('doc_1', 'Same citation')
    expect(second.requestId).not.toBe(first.requestId)
    expect(readPendingCitation('doc_1')?.requestId).toBe(second.requestId)
  })
})
