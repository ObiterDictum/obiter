import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type { DocumentModelWire } from '@obiter/contracts'

const documentModelWorkerConcurrency = 2

const documentModelTaskTimeoutMs = 600_000

const documentModelWorkerMaxWaiting = 16

export type DocumentModelTask =
  { kind: 'parse'; json: string } | { kind: 'generate'; bytes: Uint8Array }

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
  return createRequire(import.meta.url).resolve('tsx')
}

function spawnDocumentModelWorker(): Worker {
  const entry = fileURLToPath(
    new URL('./document-model-worker.ts', import.meta.url),
  )
  // SAFETY: the cast only adds an optional Bun property for runtime detection; on Node the
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
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    timer.unref()
  }
}

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

  private pump(): void {
    while (!this.closed) {
      const free = this.slots.find((slot) => slot.waiting === null)
      if (free) {
        const waiter = this.waiting.shift()
        if (!waiter) return
        this.dispatch(free, waiter)
        continue
      }
      if (this.waiting.length === 0 || this.slots.length >= this.maxWorkers) {
        return
      }
      try {
        this.attach(this.spawnWorker())
      } catch (error) {
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
    if (index === -1) return
    this.slots.splice(index, 1)
    if (slot.timer) {
      clearTimeout(slot.timer)
      slot.timer = null
    }
    const waiter = slot.waiting
    slot.waiting = null
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

export function closeDocumentModelWorkers(): Promise<void> {
  return sharedDocumentModelPool.close()
}
