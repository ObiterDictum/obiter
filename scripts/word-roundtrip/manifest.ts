import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/**
 * The acceptance record: provenance, artifact hashes, the Word leg's status
 * and the semantic comparison. Written at every exit — pass, fail and
 * awaiting the operator step alike — so an interrupted run is still honest
 * about how far it got.
 */
export type RoundtripManifest = {
  harness: 'word-roundtrip'
  generatedAt: string
  runtime: { bun: string; platform: string }
  api: string
  git: string
  /** The database the API reported it is bound to — server-attested, not the
   * CLI flag's word for it. */
  databaseName: string
  artifacts: Record<string, { sha256: string; bytes: number }>
  cycle1?: { documentId: string; summary: Record<string, unknown> }
  obiterCycles?: {
    fixture: string
    documentId: string
    byteIdentical: boolean
    summary: Record<string, unknown>
  }[]
  word?: Record<string, unknown>
  cycle2?: { documentId: string; summary: Record<string, unknown> }
  semanticComparison?: Record<string, unknown>
  result?: string
}

export type RunManifest = {
  manifest: RoundtripManifest
  record(name: string, bytes: Uint8Array): string
  write(): void
  fail(message: string): never
}

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createRunManifest(
  outDir: string,
  provenance: { api: string; git: string; databaseName: string },
): RunManifest {
  const manifest: RoundtripManifest = {
    harness: 'word-roundtrip',
    generatedAt: new Date().toISOString(),
    runtime: { bun: Bun.version, platform: process.platform },
    api: provenance.api,
    git: provenance.git,
    databaseName: provenance.databaseName,
    artifacts: {},
  }

  const write = () =>
    writeFileSync(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    )

  return {
    manifest,
    write,
    record(name, bytes) {
      const file = path.join(outDir, name)
      writeFileSync(file, bytes)
      manifest.artifacts[name] = { sha256: sha256(bytes), bytes: bytes.length }
      console.log(`wrote ${file} (${String(bytes.length)} bytes)`)
      return file
    },
    fail(message: string): never {
      console.error(`FAIL: ${message}`)
      manifest.result = `fail: ${message}`
      write()
      process.exit(1)
    },
  }
}
