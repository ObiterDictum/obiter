import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const matterTables =
  /\b(?:from|join|update|into)\s+(?:matters|matter_documents|document_versions|redaction_runs)\b/i

describe('matter resource architecture boundary', () => {
  it('prevents route modules from resolving matter-derived rows directly', async () => {
    const routeDirectory = new URL('./routes/', import.meta.url)
    const files = (await readdir(routeDirectory)).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('.test') &&
        file !== 'document-access.ts',
    )
    const bypasses: string[] = []

    for (const file of files) {
      const source = await readFile(new URL(file, routeDirectory), 'utf8')
      if (matterTables.test(source)) bypasses.push(file)
    }

    expect(bypasses).toEqual([])
  })
})
