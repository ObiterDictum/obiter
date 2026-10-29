import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InferenceSession } from 'onnxruntime-node'
import { describe, expect, it } from 'bun:test'

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/onnx/identity.onnx',
)

describe('native ONNX Runtime', () => {
  it('loads the CPU binding and returns a deterministic inference', async () => {
    const session = await InferenceSession.create(await readFile(fixture), {
      executionProviders: ['cpu'],
    })
    try {
      expect(session.inputNames).toEqual([])
      expect(session.outputNames).toEqual(['Y'])

      const output = await session.run({})
      const tensor = output.Y
      if (!tensor) throw new Error('inference returned no Y output')

      expect(tensor.dims).toEqual([2])
      expect([...tensor.data]).toEqual([1, 2])
    } finally {
      await session.release()
    }
  })
})
