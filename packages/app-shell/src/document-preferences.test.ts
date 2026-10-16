import { describe, expect, it } from 'bun:test'

import { MapStorage } from './document-draft-store-test-support'
import { readCitationStyle, writeCitationStyle } from './document-preferences'

describe('citation style preference', () => {
  it('defaults to oscola when nothing is stored', () => {
    expect(readCitationStyle(new MapStorage(), 'doc_1')).toBe('oscola')
  })

  it('round-trips a stored style scoped to the document', () => {
    const storage = new MapStorage()
    writeCitationStyle(storage, 'doc_1', 'house')
    expect(readCitationStyle(storage, 'doc_1')).toBe('house')
    // Another document on the same store keeps its own default.
    expect(readCitationStyle(storage, 'doc_2')).toBe('oscola')
  })

  it('falls back to oscola on a value the schema does not know', () => {
    const storage = new MapStorage()
    storage.setItem('obiter.citation-style.v1.doc_1', 'bluebook')
    expect(readCitationStyle(storage, 'doc_1')).toBe('oscola')
  })

  it('degrades quietly when storage refuses reads and writes', () => {
    const storage = new MapStorage()
    storage.failReads = true
    expect(readCitationStyle(storage, 'doc_1')).toBe('oscola')
    storage.failWrites = true
    expect(() => writeCitationStyle(storage, 'doc_1', 'house')).not.toThrow()
  })
})
