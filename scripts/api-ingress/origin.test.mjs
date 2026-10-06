import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { server } from './origin.mjs'

let base = ''

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  // Do not hold the test process open on an idle keep-alive socket.
  server.unref()
})

afterAll(() => {
  server.closeAllConnections?.()
  server.close()
})

async function request(path) {
  const response = await fetch(`${base}${path}`)
  const body = await response.arrayBuffer()
  return { status: response.status, body: Buffer.from(body).toString('utf8') }
}

const INVALID = [
  'chunks=0',
  'chunks=257',
  'chunks=-1',
  'chunks=1.5',
  'chunks=abc',
  'chunks=',
  'chunkBytes=0',
  'chunkBytes=4194305',
  'chunkBytes=1.5',
  'chunkBytes=abc',
  'chunkBytes=',
  'intervalMs=-1',
  'intervalMs=60001',
  'intervalMs=abc',
  'intervalMs=',
  'headerDelayMs=-1',
  'headerDelayMs=60001',
  'headerDelayMs=abc',
  'headerDelayMs=',
]

describe('origin /stream parameter bounds', () => {
  it('answers health', async () => {
    expect((await request('/health')).status).toBe(200)
  })

  it('serves a query within every bound', async () => {
    expect(
      (await request('/stream?chunks=2&chunkBytes=16&intervalMs=0')).status,
    ).toBe(200)
  })

  it('accepts each parameter at its bound', async () => {
    expect(
      (await request('/stream?chunks=256&chunkBytes=1&intervalMs=0')).status,
    ).toBe(200)
    expect(
      (await request('/stream?chunks=1&chunkBytes=4194304&intervalMs=0'))
        .status,
    ).toBe(200)
    expect(
      (await request('/stream?chunks=1&chunkBytes=1&intervalMs=60000')).status,
    ).toBe(200)
  })

  for (const query of INVALID) {
    it(`rejects ${query} with 400 instead of clamping it`, async () => {
      const response = await request(`/stream?${query}`)
      expect(response.status).toBe(400)
      expect(response.body).toContain('invalid_stream_params')
    })
  }
})
