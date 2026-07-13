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
})
