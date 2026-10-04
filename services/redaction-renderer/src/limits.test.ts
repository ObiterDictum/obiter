import { describe, expect, it } from 'bun:test'
import { Readable } from 'node:stream'
import { REDACTION_RENDERER_ERROR_CODES } from './contract'
import { RendererFailure } from './renderer'
import {
  messageForErrorCode,
  readStreamBody,
  statusForErrorCode,
} from './server'

describe('renderer body limits', () => {
  it('reads a body under the ceiling', async () => {
    const body = await readStreamBody(
      Readable.from([new Uint8Array([1, 2]), new Uint8Array([3])]),
      8,
    )
    expect([...body]).toEqual([1, 2, 3])
  })

  it('refuses a body that crosses the ceiling', async () => {
    let code: string | undefined
    try {
      await readStreamBody(Readable.from([new Uint8Array(9)]), 8)
    } catch (error) {
      if (error instanceof RendererFailure) code = error.code
    }
    expect(code).toBe('input_too_large')
  })
})

describe('renderer failure mapping', () => {
  it('maps every error code to a client status and a safe message', () => {
    for (const code of REDACTION_RENDERER_ERROR_CODES) {
      const status = statusForErrorCode(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
      expect(messageForErrorCode(code).length).toBeGreaterThan(0)
    }
  })
})
