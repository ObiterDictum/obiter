import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export interface EncryptionStorage {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(cipherText: Buffer): string
}

/**
 * Main-process-only token custody. The renderer receives a token only through
 * the preload bridge and never receives a filesystem capability.
 *
 * Ordering rule (applied to every method): the durable operation runs first
 * and only on success does memory change. A failed persist must not leave
 * memory claiming success; a failed clear must not leave memory nulled while
 * the disk keeps the token.
 */
export class DesktopAuthTokenStore {
  private memoryToken: string | null = null
  private warnedEncryptionUnavailable = false
  private operation: Promise<void> = Promise.resolve()

  constructor(
    private readonly tokenPath: string,
    private readonly encryptionStorage: EncryptionStorage,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  get(): Promise<string | null> {
    return this.enqueue(async () => {
      if (!this.encryptionStorage.isEncryptionAvailable()) {
        this.warnEncryptionUnavailable()
        // A leftover undecryptable file must not break reads: swallow a
        // non-ENOENT rm failure, warn once, and still return the memory token.
        try {
          await rm(this.tokenPath, { force: true })
        } catch {
          this.warn(
            '[obiter] Unable to remove an unreadable desktop auth token file.',
          )
        }
        return this.memoryToken
      }

      try {
        const encrypted = await readFile(this.tokenPath)
        this.memoryToken = this.encryptionStorage.decryptString(encrypted)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.warn('[obiter] Unable to read the desktop auth token.')
        }
      }

      return this.memoryToken
    })
  }

  set(token: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.encryptionStorage.isEncryptionAvailable()) {
        this.warnEncryptionUnavailable()
        // Memory-only path: deliberately no disk state. Keep the previous
        // memory-only behaviour — warn once, do not persist.
        await rm(this.tokenPath, { force: true })
        this.memoryToken = token
        return
      }

      const temporaryPath = `${this.tokenPath}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(this.tokenPath), { recursive: true })
        await writeFile(
          temporaryPath,
          this.encryptionStorage.encryptString(token),
        )
        await rename(temporaryPath, this.tokenPath)
      } finally {
        // Clean up the temp file whether the write/rename succeeded or not.
        // force:true swallows ENOENT (nothing to clean); guard so a cleanup
        // failure does not mask the original error.
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }

      // Durable write succeeded: only now update memory.
      this.memoryToken = token
    })
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      // Durable first: remove the file before nulling memory, so a failed clear
      // (EACCES/EBUSY/EPERM, which force:true does NOT swallow) propagates and
      // memory is left honest about the token still on disk. A later get()
      // re-reads the disk and does not resurrect after a failed clear.
      await rm(this.tokenPath, { force: true })
      this.memoryToken = null
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private warnEncryptionUnavailable() {
    if (!this.warnedEncryptionUnavailable) {
      this.warnedEncryptionUnavailable = true
      this.warn(
        '[obiter] OS encryption is unavailable; desktop auth is memory-only for this session.',
      )
    }
  }
}
