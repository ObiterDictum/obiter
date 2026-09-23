import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type { DocumentModelWire } from '@obiter/contracts'

/**
 * How many document-model loads may execute at once. Loading a model is
 * CPU-bound single-threaded work: more workers would compete for the same
 * cores while multiplying peak memory (each worker transiently holds the
 * source bytes, the parsed model and its JSON). Two lets a verification run
 * and an editor model fetch proceed together without letting a burst of
 * uploads or verifications grow the process's worker footprint.
 */
export const documentModelWorkerConcurrency = 2

/**
 * The one task the worker executes. `parse` validates an already-stored
 * `model.json`; `generate` parses source bytes into a model and its JSON.
 * Both are the synchronous work that used to run on the serving event loop.
 */
export type DocumentModelTask =
  { kind: 'parse'; json: string } | { kind: 'generate'; bytes: Uint8Array }

/**
 * A task's outcome. `invalid` means a cached model must be regenerated from
 * the source (never a failure to the caller), `failed` means the caller
 * reports the curated model-unavailable error. `json` is set only by
 * `generate`, so the caller can persist exactly what was validated.
 */
export type DocumentModelTaskResult =
  | { status: 'ok'; model: DocumentModelWire; json: string | null }
  | { status: 'invalid' }
  | { status: 'failed' }

interface TaskMessage {
  id: number
  task: DocumentModelTask
}

interface ResultMessage {
  id: number
  result: DocumentModelTaskResult
}

interface WaitingTask {
  task: DocumentModelTask
  resolve: (result: DocumentModelTaskResult) => void
  reject: (error: Error) => void
}

interface WorkerSlot {
  worker: Worker
  waiting: WaitingTask | null
  taskId: number
}

function tsxLoaderPath(): string {
  // Absolute, so the worker's --import resolves from this module's package
  // rather than from whatever directory the process happens to run in.
  return createRequire(import.meta.url).resolve('tsx')
}

function spawnDocumentModelWorker(): Worker {
  const entry = fileURLToPath(
    new URL('./document-model-worker.ts', import.meta.url),
  )
  // Bun executes TypeScript natively and does not take a Node --import;
  // Node needs the loader because the workspace packages ship TypeScript
  // source only. The same rule as the two server entry points, applied to
  // their workers.
  const options =
    typeof (globalThis as { Bun?: unknown }).Bun === 'undefined'
      ? { execArgv: ['--import', tsxLoaderPath()] }
      : {}
  const worker = new Worker(entry, options)
  worker.unref()
  return worker
}

/**
 * A bounded pool of document-model worker threads.
 *
 * Tasks are dispatched only when a worker is free: there is no task queue to
 * grow, because a caller waits for a slot instead of parking a payload. The
 * waiters are in-flight HTTP requests, the same work that used to occupy the
 * event loop, so concurrency and memory stay bounded by
 * `documentModelWorkerConcurrency` plus the requests the server already
 * holds. A worker that fails is dropped with its task rejected and is
 * replaced lazily on the next dispatch; `close()` rejects everything
 * in flight and terminates the workers, which is what shutdown waits on.
 *
 * The constructor's arguments exist for tests, which drive scheduling with a
 * fake worker at the thread boundary; production uses the defaults.
 */
export class DocumentModelWorkerPool {
  private readonly slots: WorkerSlot[] = []
  private readonly waiting: WaitingTask[] = []
  private nextTaskId = 1
  private closed = false

  constructor(
    private readonly spawnWorker: () => Worker = spawnDocumentModelWorker,
    private readonly maxWorkers: number = documentModelWorkerConcurrency,
  ) {}

  run(task: DocumentModelTask): Promise<DocumentModelTaskResult> {
    if (this.closed) {
      return Promise.reject(
        new Error('The document model worker pool is closed.'),
      )
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject })
      this.pump()
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const closed = new Error('The document model worker pool is closed.')
    for (const waiter of this.waiting.splice(0)) waiter.reject(closed)
    const slots = this.slots.splice(0)
    await Promise.all(
      slots.map((slot) => {
        if (slot.waiting) {
          slot.waiting.reject(closed)
          slot.waiting = null
        }
        return slot.worker.terminate()
      }),
    )
  }

  private pump(): void {
    while (!this.closed) {
      const free = this.slots.find((slot) => slot.waiting === null)
      if (free) {
        const waiter = this.waiting.shift()
        if (!waiter) return
        this.dispatch(free, waiter)
        continue
      }
      // Spawn only for work that is actually waiting and unclaimed: a second
      // worker exists because two loads contend, never just because one did.
      if (this.waiting.length === 0 || this.slots.length >= this.maxWorkers) {
        return
      }
      this.attach(this.spawnWorker())
    }
  }

  private dispatch(slot: WorkerSlot, waiter: WaitingTask): void {
    const id = this.nextTaskId++
    slot.waiting = waiter
    slot.taskId = id
    slot.worker.ref()
    slot.worker.postMessage({ id, task: waiter.task } satisfies TaskMessage)
  }

  private attach(worker: Worker): WorkerSlot {
    const slot: WorkerSlot = { worker, waiting: null, taskId: 0 }
    worker.on('message', (message: ResultMessage) => {
      const waiter = slot.waiting
      if (!waiter || message.id !== slot.taskId) {
        this.drop(
          slot,
          new Error('The document model worker sent an unexpected message.'),
        )
        return
      }
      slot.waiting = null
      worker.unref()
      waiter.resolve(message.result)
      this.pump()
    })
    worker.on('error', (error: Error) => this.drop(slot, error))
    worker.on('exit', (code: number) =>
      this.drop(
        slot,
        new Error(`The document model worker exited with code ${code}.`),
      ),
    )
    this.slots.push(slot)
    return slot
  }

  private drop(slot: WorkerSlot, error: Error): void {
    const index = this.slots.indexOf(slot)
    // A crashed worker fires both 'error' and 'exit'; only the first event
    // owns the slot, so the in-flight task is rejected exactly once.
    if (index === -1) return
    this.slots.splice(index, 1)
    const waiter = slot.waiting
    slot.waiting = null
    // Best-effort cleanup of an already-failed thread; it can never reject,
    // and a rejection here would take the process down over housekeeping.
    void slot.worker.terminate().catch(() => undefined)
    if (waiter) waiter.reject(error)
    if (!this.closed) this.pump()
  }
}

const sharedDocumentModelPool = new DocumentModelWorkerPool()

export function runDocumentModelTask(
  task: DocumentModelTask,
): Promise<DocumentModelTaskResult> {
  return sharedDocumentModelPool.run(task)
}

/** Idempotent. Entry points call it from their shutdown resource close. */
export function closeDocumentModelWorkers(): Promise<void> {
  return sharedDocumentModelPool.close()
}
