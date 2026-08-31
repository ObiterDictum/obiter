import { describe, expect, it } from 'vitest'
import {
  MAX_DOCUMENT_UPLOAD_BYTES,
  readDocumentUpload,
} from './document-upload'

describe('readDocumentUpload', () => {
  it('rejects files whose declared size exceeds the upload max', async () => {
    const bytes = Buffer.from('Plain text')
    const file = new File([bytes], 'fixture.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'size', {
      value: MAX_DOCUMENT_UPLOAD_BYTES + 1,
    })

    await expect(readDocumentUpload(file, 'txt')).rejects.toMatchObject({
      name: 'DocumentUploadError',
      message: expect.stringContaining('25 MB'),
    })
  })
})
