import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expectedMatrixCells } from './matrix'
import type { SyntheticDocument } from './types'

export async function writeDataset(
  directory: string,
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'documents.jsonl'),
    `${documents.map((document) => JSON.stringify(document)).join('\n')}\n`,
  )
  await writeFile(
    join(directory, 'MANIFEST.json'),
    `${JSON.stringify(
      {
        algorithm: 'sha256:text:utf8',
        documents: documents.map(({ id, contentHash }) => ({
          id,
          contentHash,
        })),
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(directory, 'stats.json'),
    `${JSON.stringify({ ...datasetStats(documents), ...metadata }, null, 2)}\n`,
  )
}

export function datasetStats(documents: SyntheticDocument[]) {
  const categories: Record<string, number> = {}
  const matrix: Record<string, number> = {}
  const lengths = documents
    .map((document) => document.text.length)
    .sort((a, b) => a - b)
  for (const document of documents) {
    for (const span of document.spans)
      categories[span.category] = (categories[span.category] ?? 0) + 1
    for (const cell of document.matrixCells)
      matrix[cell] = (matrix[cell] ?? 0) + 1
  }
  const missingCells = expectedMatrixCells().filter((cell) => !matrix[cell])
  return {
    totalDocuments: documents.length,
    spansByCategory: categories,
    matrix,
    missingMatrixCells: missingCells,
    documentLengthCharacters: {
      min: lengths[0] ?? 0,
      median: lengths[Math.floor(lengths.length / 2)] ?? 0,
      max: lengths.at(-1) ?? 0,
    },
  }
}

export async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}
