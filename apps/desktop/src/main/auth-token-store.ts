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
        await rm(this.tokenPath, { force: true })
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
      this.memoryToken = token

      if (!this.encryptionStorage.isEncryptionAvailable()) {
        this.warnEncryptionUnavailable()
        await rm(this.tokenPath, { force: true })
        return
      }

      const temporaryPath = `${this.tokenPath}.${randomUUID()}.tmp`
      await mkdir(dirname(this.tokenPath), { recursive: true })
      await writeFile(
        temporaryPath,
        this.encryptionStorage.encryptString(token),
      )
      await rename(temporaryPath, this.tokenPath)
    })
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.memoryToken = null
      await rm(this.tokenPath, { force: true })
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
