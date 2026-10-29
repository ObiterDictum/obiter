import { describe, expect, it } from 'bun:test'
import { readBoundedResponseText } from './bounded-upstream-body'

describe('bounded upstream response', () => {
  it('discards partial text when the response stream fails', async () => {
    let read = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read) {
          controller.error(new Error('synthetic stream failure'))
          return
        }
        read = true
        controller.enqueue(new TextEncoder().encode('partial'))
      },
    })

    expect(await readBoundedResponseText(new Response(stream), 1024)).toBeNull()
  })
})
