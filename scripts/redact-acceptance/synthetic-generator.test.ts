import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateSyntheticData } from '../generate-synthetic-data'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

interface SyntheticEntry {
  text: string
  spans: Record<string, Array<[number, number]>>
  info: { documentType: string }
}

async function readJsonLines(path: string) {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SyntheticEntry)
}

describe('Redact 3 synthetic generator acceptance', () => {
  it('generates at least 200 validated documents across at least 7 types', async () => {
    const output = await mkdtemp(join(tmpdir(), 'obiter-redact-synthetic-'))
    temporaryDirectories.push(output)

    await generateSyntheticData(output)

    const entries = [
      ...(await readJsonLines(join(output, 'synthetic_train.jsonl'))),
      ...(await readJsonLines(join(output, 'synthetic_validation.jsonl'))),
    ]
    const documentTypes = new Set(
      entries.map((entry) => entry.info.documentType),
    )

    expect(entries.length).toBeGreaterThanOrEqual(200)
    expect(documentTypes.size).toBeGreaterThanOrEqual(7)

    for (const entry of entries) {
      expect(entry.text).toEqual(expect.any(String))
      expect(entry.info.documentType).toEqual(expect.any(String))
      for (const [key, offsets] of Object.entries(entry.spans)) {
        const value = key.slice(key.indexOf(': ') + 2)
        for (const [start, end] of offsets) {
          expect(start).toBeLessThan(end)
          expect(end).toBeLessThanOrEqual(entry.text.length)
          expect(entry.text.slice(start, end)).toBe(value)
        }
      }
    }

    const manifest = JSON.parse(
      await readFile(join(output, 'generation_manifest.json'), 'utf8'),
    ) as { totalDocuments: number; documentTypes: Record<string, number> }
    const report = JSON.parse(
      await readFile(join(output, 'validation_report.json'), 'utf8'),
    ) as { valid: boolean; documentsValidated: number; failures: unknown[] }

    expect(manifest.totalDocuments).toBe(entries.length)
    expect(Object.keys(manifest.documentTypes)).toHaveLength(documentTypes.size)
    expect(report).toEqual({
      valid: true,
      documentsValidated: entries.length,
      failures: [],
    })
  })
})
