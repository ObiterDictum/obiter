import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const protectedTables =
  /\b(?:from|join|update|into)\s+(?:[a-z_]\w*\.)?(?:matters|matter_shares|matter_documents|document_versions|redaction_runs|artifacts|audit_logs)\b/i

const organisationInviteTable =
  /\b(?:from|join|update|into)\s+(?:[a-z_]\w*\.)?organisation_invites\b/i

describe('matter resource architecture boundary', () => {
  it('prevents route modules from resolving matter-derived rows directly', async () => {
    const routeDirectory = new URL('./routes/', import.meta.url)
    const files = (await readdir(routeDirectory, { recursive: true })).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('.test') &&
        !file.endsWith('.seed.ts') &&
        // Only the top-level document-access module may query these tables;
        // matching the complete relative path prevents a nested bypass.
        file !== 'document-access.ts',
    )
    const bypasses: string[] = []

    for (const file of files) {
      const source = await readFile(new URL(file, routeDirectory), 'utf8')
      if (protectedTables.test(source)) bypasses.push(file)
    }

    expect(bypasses).toEqual([])
  })

  it('prevents route modules from querying organisation_invites outside organisations.ts', async () => {
    const routeDirectory = new URL('./routes/', import.meta.url)
    const files = (await readdir(routeDirectory, { recursive: true })).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.includes('.test') &&
        !file.endsWith('.seed.ts') &&
        file !== 'organisations.ts',
    )
    const bypasses: string[] = []

    for (const file of files) {
      const source = await readFile(new URL(file, routeDirectory), 'utf8')
      if (organisationInviteTable.test(source)) bypasses.push(file)
    }

    expect(bypasses).toEqual([])
  })
})
