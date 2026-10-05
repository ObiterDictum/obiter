import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InferenceSession } from 'onnxruntime-node'
import { describe, expect, it } from 'bun:test'

/**
 * Proves the installed `onnxruntime-node` native runtime loads and runs a CPU
 * inference. Every other API test injects `loadClassifier`, so an install that
 * lost the CPU libraries or the native binding would otherwise reach production
 * as silent heuristics-only detection with no failing check.
 *
 * The fixture is a 98-byte ONNX model with a single graph: the constant
 * `X: float32[2] = [1, 2]` feeds `Identity -> Y`. It has no external inputs, so
 * `run({})` is deterministic and needs no model download, network, or GPU
 * provider. Regenerate it from the ONNX protobuf definitions if it must change.
 */
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
