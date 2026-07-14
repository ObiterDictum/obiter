import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAuthTokenStore } from './auth-token-store'

const directories: string[] = []

async function tokenPath() {
  const directory = await mkdtemp(join(tmpdir(), 'obiter-auth-token-'))
  directories.push(directory)
  return join(directory, 'desktop-auth-token')
}

afterEach(async () => {
  // Undo any vi.doMock applied by mockFs() so it does not bleed into the next
  // test's module graph, and reset the module registry.
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  )
})

describe('DesktopAuthTokenStore', () => {
  it('encrypts tokens at rest and restores them for a new store', async () => {
    const path = await tokenPath()
    const encryptionStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (token: string) =>
        Buffer.from(Buffer.from(token).toString('base64')),
      decryptString: (value: Buffer) =>
        Buffer.from(value.toString(), 'base64').toString(),
    }
    const store = new DesktopAuthTokenStore(path, encryptionStorage)

    await store.set('token_123')

    expect(await readFile(path, 'utf8')).not.toContain('token_123')
    expect(await new DesktopAuthTokenStore(path, encryptionStorage).get()).toBe(
      'token_123',
    )
  })

  it('keeps the token in memory and warns once when encryption is unavailable', async () => {
    const path = await tokenPath()
    const warn = vi.fn()
    const store = new DesktopAuthTokenStore(
      path,
      {
        isEncryptionAvailable: () => false,
        encryptString: (token: string) => Buffer.from(token),
        decryptString: (value: Buffer) => value.toString(),
      },
      warn,
    )

    await store.set('token_123')
    expect(await store.get()).toBe('token_123')
    expect(warn).toHaveBeenCalledOnce()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a persisted token when encryption becomes unavailable', async () => {
    const path = await tokenPath()
    let encryptionAvailable = true
    const encryptionStorage = {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (token: string) =>
        Buffer.from(Buffer.from(token).toString('base64')),
      decryptString: (value: Buffer) =>
        Buffer.from(value.toString(), 'base64').toString(),
    }
    const store = new DesktopAuthTokenStore(path, encryptionStorage)

    await store.set('token_123')
    encryptionAvailable = false
    await store.set('token_456')
    encryptionAvailable = true

    expect(
      await new DesktopAuthTokenStore(path, encryptionStorage).get(),
    ).toBeNull()
  })

  it('serializes sign-out behind an in-flight token write', async () => {
    const path = await tokenPath()
    const encryptionStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (token: string) =>
        Buffer.from(Buffer.from(token).toString('base64')),
      decryptString: (value: Buffer) =>
        Buffer.from(value.toString(), 'base64').toString(),
    }
    const store = new DesktopAuthTokenStore(path, encryptionStorage)

    const write = store.set('token_123')
    const clear = store.clear()
    await Promise.all([write, clear])

    expect(await store.get()).toBeNull()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps memoryToken and rejects when rm fails during clear', async () => {
    const path = await tokenPath()
    const encryptionStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (token: string) =>
        Buffer.from(Buffer.from(token).toString('base64')),
      decryptString: (value: Buffer) =>
        Buffer.from(value.toString(), 'base64').toString(),
    }
    const store = new DesktopAuthTokenStore(path, encryptionStorage)
    await store.set('token_123')

    // Point a second store at the same file but with an rm that fails with a
    // non-ENOENT error (force:true does not swallow these), simulating a
    // locked/permission-denied token file at clear time.
    const failingFs = await mockFs((name) =>
      name === 'rm'
        ? vi.fn(async () => {
            const error = new Error('EBUSY') as NodeJS.ErrnoException
            error.code = 'EBUSY'
            throw error
          })
        : undefined,
    )
    const failingStore = new failingFs.Store(path, encryptionStorage)
    // memoryToken was established by set; clear must not null it when rm fails.
    await expect(failingStore.clear()).rejects.toMatchObject({ code: 'EBUSY' })
    expect(await failingStore.get()).toBe('token_123')
  })

  it('leaves memory unchanged and removes the temp file when the set write fails', async () => {
    const path = await tokenPath()
    const warn = vi.fn()
    const encryptionStorage = {
      isEncryptionAvailable: () => true,
      // encryptString throws to trigger a write failure inside set().
      encryptString: () => {
        throw new Error('encrypt failed')
      },
      decryptString: (value: Buffer) =>
        Buffer.from(value.toString(), 'base64').toString(),
    }
    const store = new DesktopAuthTokenStore(path, encryptionStorage, warn)

    await expect(store.set('token_123')).rejects.toThrow('encrypt failed')
    // Memory was not updated after the failed persist.
    expect(await store.get()).toBeNull()
    // No .tmp file leaked.
    const { readdir } = await import('node:fs/promises')
    const dir = path.split(/[/\\]/).slice(0, -1).join('/')
    const entries = await readdir(dir)
    expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false)
  })

  it('warns and returns the memory token when encryption is unavailable and rm fails on get', async () => {
    const path = await tokenPath()
    const warn = vi.fn()
    const encryptionStorage = {
      isEncryptionAvailable: () => false,
      encryptString: (token: string) => Buffer.from(token),
      decryptString: (value: Buffer) => value.toString(),
    }
    const failingFs = await mockFs((name) =>
      name === 'rm'
        ? vi.fn(async () => {
            const error = new Error('EACCES') as NodeJS.ErrnoException
            error.code = 'EACCES'
            throw error
          })
        : undefined,
    )
    // A fresh store has memoryToken null; the fix is that get() does not reject
    // when rm fails in the encryption-unavailable branch — it warns and returns
    // memory (null here), where the pre-fix code rejected with EACCES.
    const store = new failingFs.Store(path, encryptionStorage, warn)

    await expect(store.get()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unable to remove an unreadable'),
    )
  })
})

/**
 * Load a fresh module graph where node:fs/promises is partially mocked: the
 * factory returns undefined for untouched exports (the real impl) and a vi.fn
 * override for the named ones. Returns the store class from that graph.
 */
async function mockFs(override: (name: string) => unknown | undefined) {
  const real = await import('node:fs/promises')
  vi.resetModules()
  vi.doMock('node:fs/promises', () => {
    const mocked: Record<string, unknown> = { ...real }
    for (const name of ['rm', 'rename', 'writeFile', 'readFile', 'mkdir']) {
      const fn = override(name)
      if (fn) {
        mocked[name] = fn
      }
    }
    return mocked
  })
  const mod = await import('./auth-token-store')
  return { Store: mod.DesktopAuthTokenStore }
}
