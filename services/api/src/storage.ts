import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export interface StorageService {
  readText(objectKey: string): Promise<string>
  writeText(objectKey: string, text: string): Promise<void>
  delete(objectKey: string): Promise<void>
}

function storagePath(root: string, objectKey: string) {
  if (!/^org\/[^/]+\/(?:matters\/[^/]+\/(?:documents\/[^/]+\/versions\/[^/]+\/text|artifacts\/[^/]+)|redaction-runs\/[^/]+\/source|artifacts\/[^/]+)$/.test(objectKey)) {
    throw new Error('Invalid storage object key.')
  }

  const path = resolve(root, ...objectKey.split('/'))
  const resolvedRoot = resolve(root)
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Storage object key resolves outside the configured root.')
  }
  return path
}

export function createLocalStorage(root = process.env.OBITER_STORAGE_ROOT ?? '.obiter-storage'): StorageService {
  return {
    async readText(objectKey) {
      return readFile(storagePath(root, objectKey), 'utf8')
    },
    async writeText(objectKey, text) {
      const path = storagePath(root, objectKey)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, 'utf8')
    },
    async delete(objectKey) {
      await rm(storagePath(root, objectKey), { force: true })
    },
  }
}
