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
 * How long a dispatched task may take to answer. A worker that never
 * responds parks its slot and its caller forever without this; with it, the
 * worker is terminated (both runtimes kill a spinning thread in
 * milliseconds, measured), the caller settles once, and later work proceeds.
 *
 * Calibrated, not arbitrary: uploads are capped at 25 MiB and packages at
 * 72 MiB uncompressed (package-limits-defaults.ts), and the slowest
 * legitimate document measured on the reference host, a styled
 * 5091-paragraph fixture inside every package guard, parses in about 210 s
 * under Node and 105 s under Bun, so this is roughly three times the slowest
 * observed legitimate load under the slower runtime. Parse time is
 * quadratic in paragraph count because of pre-existing per-paragraph
 * full-document scans in `@obiter/ooxml` (see `containsTrackedChange`), so
 * documents far beyond the measured envelope can still exceed this deadline
 * and fail with the curated store error; removing those scans is a separate
 * follow-up, not a reason to let callers park forever.
 */
export const documentModelTaskTimeoutMs = 600_000

/**
 * How many callers may park waiting for a free worker. Waiters hold their
 * own task payload (for `generate`, the source bytes their request already
 * read), so the list must not be bounded by request concurrency alone: a
 * burst beyond this many parked callers is rejected and surfaces as the
 * curated store error, which keeps retention bounded at
 * `documentModelWorkerMaxWaiting` payloads whatever the server's request
 * concurrency turns out to be.
 */
export const documentModelWorkerMaxWaiting = 16

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
  timer: ReturnType<typeof setTimeout> | null
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

function containedError(message: string, cause: unknown): Error {
  return new Error(message, cause instanceof Error ? { cause } : undefined)
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  // A deadline must never be the reason a process stays alive; a runtime
  // that returns a plain handle simply has nothing to unref.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    timer.unref()
  }
}

/**
 * A bounded pool of document-model worker threads.
 *
 * A caller dispatches immediately when a worker is free; otherwise it parks
 * in a FIFO of waiting callers, each still holding its own task payload (for
 * `generate`, the source bytes its request already read). That list is the
 * queue this pool does have: it is bounded by `documentModelWorkerMaxWaiting`
 * rather than by the server's request concurrency, callers beyond the bound
 * are rejected with the pool's own error, and there is no cancellation, so
 * an abandoned request's task still runs when its turn comes. Concurrency
 * and memory stay bounded by `documentModelWorkerConcurrency` workers plus
 * at most that many parked payloads.
 *
 * Every dispatched task gets `documentModelTaskTimeoutMs` to answer; a worker
 * that never responds is terminated, its caller settles once, and the slot is
 * replaced lazily on the next dispatch. A worker that errors, exits or sends
 * an unexpected message is dropped with its task rejected exactly once; a
 * `new Worker` call that throws synchronously (fd, thread or memory
 * pressure) is contained inside `pump()` and settles the head waiter, because
 * `pump()` also runs from inside worker event listeners, where an escaped
 * throw would take the process down. `close()` rejects everything in flight
 * and terminates the workers, which is what shutdown waits on.
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
    private readonly taskTimeoutMs: number = documentModelTaskTimeoutMs,
    private readonly maxWaiting: number = documentModelWorkerMaxWaiting,
  ) {}

  run(task: DocumentModelTask): Promise<DocumentModelTaskResult> {
    if (this.closed) {
      return Promise.reject(
        new Error('The document model worker pool is closed.'),
      )
    }
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.reject(
        new Error(
          `The document model worker pool already has ${this.maxWaiting} tasks waiting.`,
        ),
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
        if (slot.timer) {
          clearTimeout(slot.timer)
          slot.timer = null
        }
        if (slot.waiting) {
          slot.waiting.reject(closed)
          slot.waiting = null
        }
        return slot.worker.terminate()
      }),
    )
  }

  /** Never throws: it runs from inside worker event listeners. */
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
      try {
        this.attach(this.spawnWorker())
      } catch (error) {
        // `new Worker` throws synchronously under the same host pressure that
        // kills workers. Contain it here, settle the head waiter once, and
        // let the next dispatch attempt the spawn again; retrying in this
        // tick would spin through every waiter.
        this.waiting
          .shift()
          ?.reject(
            containedError(
              'The document model worker could not be spawned.',
              error,
            ),
          )
        return
      }
    }
  }

  private dispatch(slot: WorkerSlot, waiter: WaitingTask): void {
    const id = this.nextTaskId++
    slot.waiting = waiter
    slot.taskId = id
    slot.worker.ref()
    try {
      slot.worker.postMessage({ id, task: waiter.task } satisfies TaskMessage)
    } catch (error) {
      // A payload the thread boundary refuses leaves the slot exactly as it
      // was found: idle and unclaimed, with only this caller to settle.
      slot.waiting = null
      slot.taskId = 0
      slot.worker.unref()
      waiter.reject(
        containedError(
          'The document model worker could not be dispatched.',
          error,
        ),
      )
      return
    }
    const timer = setTimeout(() => {
      slot.timer = null
      if (this.closed || slot.taskId !== id || !this.slots.includes(slot)) {
        return
      }
      this.drop(
        slot,
        new Error(
          `The document model worker did not respond within ${this.taskTimeoutMs} ms.`,
        ),
      )
    }, this.taskTimeoutMs)
    unrefTimer(timer)
    slot.timer = timer
  }

  private attach(worker: Worker): WorkerSlot {
    const slot: WorkerSlot = { worker, waiting: null, taskId: 0, timer: null }
    worker.on('message', (message: ResultMessage) => {
      const waiter = slot.waiting
      if (!waiter || message.id !== slot.taskId) {
        this.drop(
          slot,
          new Error('The document model worker sent an unexpected message.'),
        )
        return
      }
      if (slot.timer) {
        clearTimeout(slot.timer)
        slot.timer = null
      }
      slot.waiting = null
      worker.unref()
      waiter.resolve(message.result)
      this.pump()
    })
    worker.on('error', (error: Error) => this.drop(slot, error))
    worker.on('messageerror', (error: Error) => this.drop(slot, error))
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
    // A crashed worker fires 'error', 'exit' and possibly 'messageerror';
    // only the first event owns the slot, so the in-flight task is rejected
    // exactly once however many signals arrive.
    if (index === -1) return
    this.slots.splice(index, 1)
    if (slot.timer) {
      clearTimeout(slot.timer)
      slot.timer = null
    }
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
