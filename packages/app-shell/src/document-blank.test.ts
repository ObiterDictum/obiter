import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { blankDocumentFile } from './document-blank'

describe('blankDocumentFile', () => {
  it('builds an Untitled Word document for upload', async () => {
    const file = await blankDocumentFile()
    expect(file.name).toBe('Untitled.docx')
    expect(file.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(file.size).toBeGreaterThan(0)
  })
})
