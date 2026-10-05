import { parentPort } from 'node:worker_threads'
import type { DocumentNumberingWire } from '@obiter/contracts'
import {
  OoxmlError,
  parseDocx,
  parseModelJson,
  serialiseModelJson,
} from '@obiter/ooxml'
import type {
  DocumentModelTask,
  DocumentModelTaskResult,
} from './document-model-pool'

/**
 * Worker-thread entry for document-model loading. Everything here used to run
 * synchronously on the serving event loop inside `document-model-store`:
 * parsing a stored `model.json`, or inflating and parsing the whole OOXML
 * package and serialising its model. Keeping it on a worker thread is what
 * lets search, health and every other route keep answering while a document
 * of any size loads. The module is side-effect-free when imported from a
 * test: without a `parentPort` there is nothing to listen on.
 */

interface CachedModelProbe {
  changes?: unknown
  numbering?: DocumentNumberingWire[]
}

function cachedModelNeedsRegeneration(json: string) {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null) return false
    if (!Object.hasOwn(value, 'changes')) return true
    // SAFETY: storage JSON is DocumentModelWire from our own serialization; probe numbering via named CachedModelProbe interface, outside Zod schema, validated by subsequent array check
    const probe = value as CachedModelProbe
    const numbering = probe.numbering
    if (!Array.isArray(numbering)) return false
    return numbering.some(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        Object.hasOwn(item, 'numberingId') &&
        !Object.hasOwn(item, 'levels'),
    )
  } catch {
    // Defer malformed JSON to parseModelJson and its curated invalid-model path.
    return false
  }
}

async function runTask(
  task: DocumentModelTask,
): Promise<DocumentModelTaskResult> {
  switch (task.kind) {
    case 'parse': {
      try {
        if (cachedModelNeedsRegeneration(task.json)) {
          return { status: 'invalid' }
        }
        return { status: 'ok', model: parseModelJson(task.json), json: null }
      } catch (error) {
        if (
          error instanceof OoxmlError &&
          error.code === 'invalid-model-json'
        ) {
          return { status: 'invalid' }
        }
        return { status: 'failed' }
      }
    }
    case 'generate': {
      try {
        const json = serialiseModelJson(await parseDocx(task.bytes))
        return { status: 'ok', model: parseModelJson(json), json }
      } catch {
        // The same discard the pre-worker code applied: a parser, schema or
        // serialisation failure never reaches a response or log as a
        // diagnostic; the caller reports the curated model-unavailable error.
        return { status: 'failed' }
      }
    }
    default: {
      const unhandled: never = task
      return unhandled
    }
  }
}

const port = parentPort
if (port) {
  port.on('message', (message: { id: number; task: DocumentModelTask }) => {
    void runTask(message.task).then(
      (result) => port.postMessage({ id: message.id, result }),
      () => port.postMessage({ id: message.id, result: { status: 'failed' } }),
    )
  })
}
