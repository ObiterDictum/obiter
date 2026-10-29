import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH } from '@obiter/contracts'

import { readImageInsert } from './document-image-inserts'

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

describe('image insert picker', () => {
  it('refuses a file whose bytes disagree with its declared type', async () => {
    const file = new File([PNG_SIGNATURE], 'picture.jpg', {
      type: 'image/jpeg',
    })

    expect(await readImageInsert(file)).toEqual({
      error: 'Choose a PNG, JPEG, GIF or BMP image.',
    })
  })

  it('refuses a file too large to become a draft', async () => {
    const file = new File(
      [new Uint8Array((DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH / 4) * 3 + 1)],
      'picture.png',
      { type: 'image/png' },
    )

    expect(await readImageInsert(file)).toEqual({
      error: 'That image is too large to insert.',
    })
  })
})
