import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export interface EncryptionStorage {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(cipherText: Buffer): string
}

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
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? error.code
            : undefined
        if (code !== 'ENOENT') {
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
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }

      this.memoryToken = token
    })
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
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
