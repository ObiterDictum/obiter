import { describe, expect, it } from 'bun:test'
import { Readable } from 'node:stream'
import { REDACTION_RENDERER_ERROR_CODES } from './contract'
import { createRenderQueue, RendererFailure } from './renderer'
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

describe('render queue', () => {
  it('grants a waiter when the active render releases the slot', async () => {
    const queue = createRenderQueue(4, 1_000)
    await queue.acquire()
    const waiter = queue.acquire()
    queue.release()
    await waiter
  })

  it('rejects a waiter that cannot start within the wait bound', async () => {
    const queue = createRenderQueue(4, 20)
    await queue.acquire()
    let code: string | undefined
    try {
      await queue.acquire()
    } catch (error) {
      if (error instanceof RendererFailure) code = error.code
    }
    expect(code).toBe('at_capacity')
  })

  it('refuses a waiter once the bounded queue is full', async () => {
    const queue = createRenderQueue(1, 1_000)
    await queue.acquire()
    const first = queue.acquire()
    let code: string | undefined
    try {
      await queue.acquire()
    } catch (error) {
      if (error instanceof RendererFailure) code = error.code
    }
    expect(code).toBe('at_capacity')
    queue.release()
    await first
  })
})
