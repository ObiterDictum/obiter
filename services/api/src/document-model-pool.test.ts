import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
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

function makePool(
  maxWorkers?: number,
  taskTimeoutMs?: number,
  maxWaiting?: number,
) {
  const fakes: FakeWorker[] = []
  const spawn = () => {
    const fake = new FakeWorker()
    fakes.push(fake)
    return asWorker(fake)
  }
  const pool = new DocumentModelWorkerPool(
    spawn,
    maxWorkers ?? Number.POSITIVE_INFINITY,
    taskTimeoutMs,
    maxWaiting,
  )
  return { pool, fakes }
}

const task = { kind: 'parse', json: '{}' } as const

// Real spinning threads created by the deadline tests are tracked so a
// pre-fix run (no deadline yet) cannot leave one burning a core after the
// test times out.
const spawnedReal: Worker[] = []

afterEach(async () => {
  await Promise.allSettled(
    spawnedReal.splice(0).map((worker) => worker.terminate()),
  )
})

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

  it('run() contains a synchronous spawn failure and rejects its caller with the curated pool error', async () => {
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(() => {
      calls += 1
      if (calls === 2) {
        throw new Error('spawn failed: simulated resource exhaustion')
      }
      const fake = new FakeWorker()
      fakes.push(fake)
      return asWorker(fake)
    }, 2)
    const first = pool.run({ kind: 'parse', json: '{"w":1}' })
    // The first worker is busy, so this run needs a spawn: it throws.
    const second = pool.run({ kind: 'parse', json: '{"w":2}' })

    await expect(second).rejects.toThrow('could not be spawned')

    fakes[0]!.reply({ status: 'invalid' })
    await expect(first).resolves.toEqual({ status: 'invalid' })
  })

  it('a spawn failure during run() leaves no dead waiter to be dispatched later', async () => {
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(() => {
      calls += 1
      if (calls === 2) {
        throw new Error('spawn failed: simulated resource exhaustion')
      }
      const fake = new FakeWorker()
      fakes.push(fake)
      return asWorker(fake)
    }, 2)
    void pool.run({ kind: 'parse', json: '{"w":1}' }).catch(() => undefined)
    const dead = pool.run({ kind: 'parse', json: '{"w":2}' })
    await expect(dead).rejects.toThrow('could not be spawned')

    // Spawn recovers. The next live task must be the first thing dispatched
    // to the new worker, not the already-rejected waiter left behind.
    const live = pool.run({ kind: 'parse', json: '{"w":3}' })
    expect(calls).toBe(3)
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.sent[0]!.task).toEqual({ kind: 'parse', json: '{"w":3}' })
    fakes[1]!.reply({ status: 'invalid' })
    await expect(live).resolves.toEqual({ status: 'invalid' })

    fakes[0]!.reply({ status: 'invalid' })
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  it('contains a spawn failure raised from the error listener instead of letting it escape', async () => {
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(() => {
      calls += 1
      if (calls === 2) {
        throw new Error('spawn failed: simulated resource exhaustion')
      }
      const fake = new FakeWorker()
      fakes.push(fake)
      return asWorker(fake)
    }, 2)
    const first = pool.run({ kind: 'parse', json: '{"w":1}' })
    void first.catch(() => undefined)
    const queued = pool.run({ kind: 'parse', json: '{"w":2}' })
    void queued.catch(() => undefined)

    // drop() calls pump() from inside this listener. In the API process an
    // escaped throw here is an uncaughtException and the process exits.
    expect(() =>
      fakes[0]!.emit('error', new Error('worker exploded')),
    ).not.toThrow()
    await expect(queued).rejects.toThrow('could not be spawned')
    await expect(first).rejects.toThrow('worker exploded')
    // Failure containment must not retry spawns inside the same event.
    expect(calls).toBe(2)
  })

  it('contains a spawn failure raised from the reply (message) path', async () => {
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(() => {
      calls += 1
      if (calls >= 3) {
        throw new Error('spawn failed: simulated resource exhaustion')
      }
      const fake = new FakeWorker()
      fakes.push(fake)
      return asWorker(fake)
    }, 2)
    const first = pool.run({ kind: 'parse', json: '{"w":1}' })
    const second = pool.run({ kind: 'parse', json: '{"w":2}' })
    const third = pool.run({ kind: 'parse', json: '{"w":3}' })
    const fourth = pool.run({ kind: 'parse', json: '{"w":4}' })
    const fifth = pool.run({ kind: 'parse', json: '{"w":5}' })
    void first.catch(() => undefined)
    void third.catch(() => undefined)
    void fifth.catch(() => undefined)

    // A drop while waiters queue hits the first failing spawn: contained.
    expect(() => fakes[0]!.emit('error', new Error('w1 crashed'))).not.toThrow()
    await expect(first).rejects.toThrow('w1 crashed')
    await expect(third).rejects.toThrow('could not be spawned')

    // The reply path then dispatches from the queue and needs another spawn:
    // this throw must stay inside the message listener too.
    expect(() => fakes[1]!.reply({ status: 'invalid' })).not.toThrow()
    await expect(second).resolves.toEqual({ status: 'invalid' })
    await expect(fifth).rejects.toThrow('could not be spawned')
    expect(calls).toBe(4)

    fakes[1]!.reply({ status: 'invalid' })
    await expect(fourth).resolves.toEqual({ status: 'invalid' })
  })

  it('gives up on a worker that never replies, settles its caller once, and serves later work', async () => {
    const { pool, fakes } = makePool(2, 50)
    const hung = pool.run({ kind: 'parse', json: '{"h":1}' })

    await expect(hung).rejects.toThrow('did not respond within 50 ms')
    expect(fakes[0]!.terminated).toBe(1)

    // Every later signal for the dead task is a no-op: no second settle,
    // no second terminate, no throw.
    fakes[0]!.emit('exit', 1)
    fakes[0]!.emit('error', new Error('late death'))
    fakes[0]!.reply({ status: 'invalid' })
    expect(fakes[0]!.terminated).toBe(1)

    const next = pool.run({ kind: 'parse', json: '{"h":2}' })
    expect(fakes).toHaveLength(2)
    fakes[1]!.reply({ status: 'invalid' })
    await expect(next).resolves.toEqual({ status: 'invalid' })
  })

  it('terminates a real spinning worker at the deadline and keeps the pool usable', async () => {
    let markExited: (() => void) | undefined
    const exited = new Promise<void>((resolve) => {
      markExited = resolve
    })
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(
      () => {
        calls += 1
        if (calls === 1) {
          // A parser that spins instead of throwing: no message will ever
          // come back without intervention.
          const worker = new Worker('for (;;);', { eval: true })
          worker.on('exit', () => markExited?.())
          spawnedReal.push(worker)
          return worker
        }
        const fake = new FakeWorker()
        fakes.push(fake)
        return asWorker(fake)
      },
      1,
      150,
    )

    const hung = pool.run(task)
    await expect(hung).rejects.toThrow('did not respond within 150 ms')
    await expect(
      Promise.race([
        exited.then(() => 'exited' as const),
        new Promise((resolve) =>
          setTimeout(() => resolve('still-alive'), 2000),
        ),
      ]),
    ).resolves.toBe('exited')

    const next = pool.run(task)
    expect(fakes).toHaveLength(1)
    fakes[0]!.reply({ status: 'invalid' })
    await expect(next).resolves.toEqual({ status: 'invalid' })
  })

  it('treats messageerror as a worker failure, rejects once, and replaces the worker', async () => {
    const { pool, fakes } = makePool(1)
    const pending = pool.run(task)

    fakes[0]!.emit('messageerror', new Error('the result could not be read'))
    await expect(pending).rejects.toThrow('could not be read')
    expect(fakes[0]!.terminated).toBe(1)

    const next = pool.run(task)
    expect(fakes).toHaveLength(2)
    fakes[1]!.reply({ status: 'invalid' })
    await expect(next).resolves.toEqual({ status: 'invalid' })
  })

  it('rejects a caller beyond the waiting bound while parked work drains in order', async () => {
    const { pool, fakes } = makePool(1, undefined, 2)
    const first = pool.run({ kind: 'parse', json: '{"n":1}' })
    const second = pool.run({ kind: 'parse', json: '{"n":2}' })
    const third = pool.run({ kind: 'parse', json: '{"n":3}' })

    await expect(pool.run({ kind: 'parse', json: '{"n":4}' })).rejects.toThrow(
      'tasks waiting',
    )

    fakes[0]!.reply({ status: 'invalid' })
    await expect(first).resolves.toEqual({ status: 'invalid' })
    expect(fakes[0]!.sent.at(-1)!.task).toEqual({
      kind: 'parse',
      json: '{"n":2}',
    })

    fakes[0]!.reply({ status: 'invalid' })
    await expect(second).resolves.toEqual({ status: 'invalid' })
    expect(fakes[0]!.sent.at(-1)!.task).toEqual({
      kind: 'parse',
      json: '{"n":3}',
    })

    fakes[0]!.reply({ status: 'invalid' })
    await expect(third).resolves.toEqual({ status: 'invalid' })
  })

  it('after a contained spawn failure, serves later work and closes under load exactly once', async () => {
    const fakes: FakeWorker[] = []
    let calls = 0
    const pool = new DocumentModelWorkerPool(
      () => {
        calls += 1
        if (calls === 2) {
          throw new Error('spawn failed: transient')
        }
        const fake = new FakeWorker()
        fakes.push(fake)
        return asWorker(fake)
      },
      2,
      5_000,
    )
    const first = pool.run({ kind: 'parse', json: '{"c":1}' })
    const failed = pool.run({ kind: 'parse', json: '{"c":2}' })
    await expect(failed).rejects.toThrow('could not be spawned')

    const second = pool.run({ kind: 'parse', json: '{"c":3}' })
    expect(fakes).toHaveLength(2)
    expect(fakes[1]!.sent).toHaveLength(1)
    const third = pool.run({ kind: 'parse', json: '{"c":4}' })

    await pool.close()
    await expect(first).rejects.toThrow(/closed/)
    await expect(second).rejects.toThrow(/closed/)
    await expect(third).rejects.toThrow(/closed/)
    expect(fakes.map((fake) => fake.terminated)).toEqual([1, 1])
    await expect(pool.run(task)).rejects.toThrow(/closed/)
  })
})
