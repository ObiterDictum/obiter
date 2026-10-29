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
