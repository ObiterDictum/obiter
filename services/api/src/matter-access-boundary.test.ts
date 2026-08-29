import { readdir, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'

const protectedTables =
  /\b(?:from|join|update|into)\s+(?:[a-z_]\w*\.)?(?:matters|matter_shares|matter_documents|document_versions|redaction_runs|artifacts|audit_logs)\b/i

describe('matter resource architecture boundary', () => {
  it('prevents route modules from resolving matter-derived rows directly', async () => {
    const routeDirectory = new URL('./routes/', import.meta.url)
    const files = (await readdir(routeDirectory, { recursive: true })).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('.test') &&
        // document-access.ts is the one module allowed to query matter-derived tables directly.
        basename(file) !== 'document-access.ts',
    )
    const bypasses: string[] = []

    for (const file of files) {
      const source = await readFile(new URL(file, routeDirectory), 'utf8')
      if (protectedTables.test(source)) bypasses.push(file)
    }

    expect(bypasses).toEqual([])
  })
})
