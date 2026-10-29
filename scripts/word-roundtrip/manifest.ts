import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import type { DocumentEditOperation } from '../../packages/contracts/src/document-edit'
import type { WordAcceptance, WordProbe, WordRecord } from './word-step'

export type RoundtripManifest = {
  harness: 'word-roundtrip'
  generatedAt: string
  runtime: { bun: string; platform: string }
  api: string
  apiCommitSha: string | null
  apiCheckoutRoot: string | null
  git: string
  databaseName: string
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
  cycle2Edit?: {
    baseVersionId: string
    editedVersionId: string
    editedVersionNumber: number
    operations: readonly DocumentEditOperation[]
    expectedBodySha256: string
  }
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
