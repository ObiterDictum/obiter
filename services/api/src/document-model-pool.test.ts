import type { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import {
  DocumentModelWorkerPool,
  type DocumentModelTaskResult,
} from './document-model-pool'

type Listener = (argument: unknown) => void

class FakeWorker {
  readonly listeners = new Map<string, Listener[]>()
  readonly sent: Array<{ id: number; task: unknown }> = []
  terminated = 0
  refs = 0
  unrefs = 0

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  postMessage(message: { id: number; task: unknown }) {
    this.sent.push(message)
  }

  terminate() {
    this.terminated += 1
    return Promise.resolve(0)
  }

  ref() {
    this.refs += 1
  }

  unref() {
    this.unrefs += 1
  }

  emit(event: string, argument: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(argument)
  }

  reply(result: DocumentModelTaskResult) {
    const last = this.sent.at(-1)
    if (!last) throw new Error('FakeWorker was asked to reply without a task.')
    this.emit('message', { id: last.id, result })
  }
}

// SAFETY: the pool depends only on the worker surface modelled above; the
// double stands in for the thread boundary so dispatch, crash, queueing and
// shutdown scheduling can be asserted deterministically. The real thread
// boundary is covered by the document-model-store tests, which load actual
// models through actual workers.
function asWorker(fake: FakeWorker): Worker {
  return fake as unknown as Worker
}

function makePool(maxWorkers?: number) {
  const fakes: FakeWorker[] = []
  const spawn = () => {
    const fake = new FakeWorker()
    fakes.push(fake)
    return asWorker(fake)
  }
  const pool = new DocumentModelWorkerPool(
    spawn,
    maxWorkers ?? Number.POSITIVE_INFINITY,
  )
  return { pool, fakes }
}

const task = { kind: 'parse', json: '{}' } as const

describe('DocumentModelWorkerPool', () => {
  it('dispatches a task, hands back its result, and idles unref’d', async () => {
    const { pool, fakes } = makePool(1)
    const pending = pool.run(task)

    expect(fakes).toHaveLength(1)
    expect(fakes[0]!.sent).toHaveLength(1)
    expect(fakes[0]!.refs).toBe(1)
    const result = { status: 'invalid' } as const
    fakes[0]!.reply(result)
    await expect(pending).resolves.toEqual(result)
    expect(fakes[0]!.unrefs).toBe(1)
  })

  it('holds concurrency at maxWorkers and dispatches queued work to a freed slot', async () => {
    const { pool, fakes } = makePool(2)
    const first = pool.run(task)
    const second = pool.run(task)
    const third = pool.run(task)

    expect(fakes).toHaveLength(2)
    expect(fakes[0]!.sent).toHaveLength(1)
    expect(fakes[1]!.sent).toHaveLength(1)

    fakes[0]!.reply({ status: 'failed' })
    await expect(first).resolves.toEqual({ status: 'failed' })
    // The queued third task takes the freed slot; no third worker appears.
    expect(fakes).toHaveLength(2)
    expect(fakes[0]!.sent).toHaveLength(2)

    fakes[0]!.reply({ status: 'invalid' })
    fakes[1]!.reply({ status: 'invalid' })
    await expect(second).resolves.toEqual({ status: 'invalid' })
    await expect(third).resolves.toEqual({ status: 'invalid' })
  })

  it('rejects the in-flight task when a worker fails, drops it once, and respawns', async () => {
    const { pool, fakes } = makePool(1)
    const pending = pool.run(task)

    fakes[0]!.emit('error', new Error('worker exploded'))
    await expect(pending).rejects.toThrow('worker exploded')
    expect(fakes[0]!.terminated).toBe(1)

    // A crashed worker also reports an exit; the slot is already gone, so the
    // second event must not reject anything or terminate twice.
    fakes[0]!.emit('exit', 1)

    const next = pool.run(task)
    expect(fakes).toHaveLength(1 + 1)
    fakes[1]!.reply({ status: 'invalid' })
    await expect(next).resolves.toEqual({ status: 'invalid' })
  })

  it('rejects the in-flight task when a worker exits unexpectedly', async () => {
    const { pool, fakes } = makePool(1)
    const pending = pool.run(task)

    fakes[0]!.emit('exit', 3)
    await expect(pending).rejects.toThrow('exited with code 3')
  })

  it('treats an unexpected message as a worker failure', async () => {
    const { pool, fakes } = makePool(1)
    const pending = pool.run(task)

    fakes[0]!.emit('message', { id: 999, result: { status: 'invalid' } })
    await expect(pending).rejects.toThrow('unexpected message')
  })

  it('close rejects in-flight and waiting work, terminates the workers once, and refuses new tasks', async () => {
    const { pool, fakes } = makePool(2)
    const first = pool.run(task)
    const second = pool.run(task)
    const third = pool.run(task)

    await pool.close()

    await expect(first).rejects.toThrow(/closed/)
    await expect(second).rejects.toThrow(/closed/)
    await expect(third).rejects.toThrow(/closed/)
    expect(fakes[0]!.terminated).toBe(1)
    expect(fakes[1]!.terminated).toBe(1)

    await expect(pool.run(task)).rejects.toThrow(/closed/)
    await pool.close()
    expect(fakes[0]!.terminated).toBe(1)
    expect(fakes[1]!.terminated).toBe(1)
  })
})
