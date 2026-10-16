import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import type { DocumentEditOperation } from '../../packages/contracts/src/document-edit'
import type { WordAcceptance, WordProbe, WordRecord } from './word-step'

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
  /**
   * What the API itself reported as its commit and checkout when the lane
   * asked for its bound database — server-attested provenance for the code
   * that produced the exports, not the CLI's word for it.
   */
  apiCommitSha: string | null
  apiCheckoutRoot: string | null
  git: string
  /** The database the API reported it is bound to — server-attested, not the
   * CLI flag's word for it. */
  databaseName: string
  /**
   * The P0-1 release gate. `checked` requires recorded external evidence of
   * a real Word run — open without repair, save, visual comparison — which
   * mutable `docProps/app.xml` metadata can never supply, so every manifest
   * this harness writes today reads `not-checked`.
   */
  wordAcceptance: WordAcceptance
  artifacts: Record<string, { sha256: string; bytes: number }>
  cycle1?: { documentId: string; summary: Record<string, unknown> }
  obiterCycles?: {
    fixture: string
    documentId: string
    byteIdentical: boolean
    summary: Record<string, unknown>
  }[]
  word?: WordProbe | WordRecord
  /**
   * The real edit applied between the Word-labelled upload and the cycle-2
   * export: the immutable base version it addressed (the current ready
   * version the model endpoint attested — the route itself refuses a stale
   * base), the new immutable version the batch committed, the operation list
   * verbatim, and the oracle the export's body text was compared against as
   * a hash — the expectation derived from the model plus the operation, not
   * from the export itself.
   */
  cycle2Edit?: {
    baseVersionId: string
    editedVersionId: string
    editedVersionNumber: number
    operations: readonly DocumentEditOperation[]
    expectedBodySha256: string
  }
  cycle2?: { documentId: string; summary: Record<string, unknown> }
  semanticComparison?: Record<string, unknown>
  /**
   * The outcome of the automated legs: `awaiting-word-step`, `cycles-passed`
   * (the Obiter cycles and structural comparison passed; the Word gate is
   * reported separately in `wordAcceptance`), or `fail: <reason>`.
   */
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
  provenance: {
    api: string
    git: string
    databaseName: string
    apiCommitSha: string | null
    apiCheckoutRoot: string | null
  },
): RunManifest {
  const manifest: RoundtripManifest = {
    harness: 'word-roundtrip',
    generatedAt: new Date().toISOString(),
    runtime: { bun: Bun.version, platform: process.platform },
    api: provenance.api,
    apiCommitSha: provenance.apiCommitSha,
    apiCheckoutRoot: provenance.apiCheckoutRoot,
    git: provenance.git,
    databaseName: provenance.databaseName,
    wordAcceptance: 'not-checked',
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
