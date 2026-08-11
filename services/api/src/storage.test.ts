import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalStorage } from './storage'

const roots: string[] = []
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
)

describe('local storage object-key allowlist', () => {
  it('accepts document source, text, and model terminals but rejects other terminals and traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obiter-storage-'))
    roots.push(root)
    const storage = createLocalStorage(root)
    const prefix = 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1'
    await expect(
      storage.writeBinary!(`${prefix}/source`, Buffer.from('source')),
    ).resolves.toBeUndefined()
    await expect(
      storage.writeText(`${prefix}/text`, 'text'),
    ).resolves.toBeUndefined()
    await expect(
      storage.writeText(`${prefix}/model.json`, '{"version":1}'),
    ).resolves.toBeUndefined()
    await expect(storage.writeText(`${prefix}/other`, 'no')).rejects.toThrow(
      'Invalid storage object key',
    )
    await expect(
      storage.writeText(
        'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/../text',
        'no',
      ),
    ).rejects.toThrow('Invalid storage object key')
  })
})
