/*
 * Synthetic DOCX fixtures for the load run, generated per run rather than
 * committed. Measured byte size is the thing under control, so the fixture is
 * described by its own manifest (size, paragraphs, sha256) and that manifest
 * is re-checked against the bytes on disk before the run trusts it.
 *
 * Bounds are enforced here, before any request is sent: this harness measures
 * the envelope for documents the product accepts, so it must not quietly turn
 * into a near-cap payload experiment. The API's multipart cap is 25 MiB
 * (`DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES` in services/api); the default fixture
 * bound sits well under it.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const API_MULTIPART_CAP_BYTES = 25 * 1024 * 1024
export const DEFAULT_MAX_FIXTURE_BYTES = 8 * 1024 * 1024

const GENERATOR = fileURLToPath(
  new URL('./make-upload-fixtures.py', import.meta.url),
)

export class FixtureError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FixtureError'
    this.code = code
  }
}

/** Parse and shape-check the generator's manifest. */
export function parseFixtureManifest(text, { sizes }) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new FixtureError(
      'fixture_manifest_unreadable',
      'The fixture generator did not print a JSON manifest; check that python-docx is installed.',
    )
  }
  if (!Array.isArray(parsed))
    throw new FixtureError(
      'fixture_manifest_unreadable',
      'The fixture generator printed a non-array manifest.',
    )

  const entries = parsed.map((entry) => {
    for (const field of ['size', 'path', 'bytes', 'sha256', 'paragraphs'])
      if (entry?.[field] === undefined)
        throw new FixtureError(
          'fixture_manifest_incomplete',
          `A fixture entry is missing "${field}".`,
        )
    return {
      size: String(entry.size),
      path: String(entry.path),
      bytes: Number(entry.bytes),
      sha256: String(entry.sha256),
      paragraphs: Number(entry.paragraphs),
    }
  })

  for (const size of sizes)
    if (!entries.some((entry) => entry.size === size))
      throw new FixtureError(
        'fixture_missing',
        `The generator produced no "${size}" fixture.`,
      )
  return entries
}

export function assertFixtureBounds(
  entries,
  { maxBytes = DEFAULT_MAX_FIXTURE_BYTES } = {},
) {
  if (maxBytes > API_MULTIPART_CAP_BYTES)
    throw new FixtureError(
      'fixture_bound_above_api_cap',
      `--max-fixture-bytes ${maxBytes} exceeds the API's ${API_MULTIPART_CAP_BYTES}-byte multipart cap.`,
    )
  for (const entry of entries)
    if (entry.bytes > maxBytes)
      throw new FixtureError(
        'fixture_too_large',
        `Fixture "${entry.size}" is ${entry.bytes} bytes, over the ${maxBytes}-byte bound for this run. ` +
          'Lower the size or raise the bound deliberately; a near-cap burst is out of scope.',
      )
  if (entries.length === 0)
    throw new FixtureError('no_fixtures', 'No fixtures were selected.')
  return entries
}

/**
 * Generate the requested sizes into `outDir` and return them with their bytes
 * loaded once. The buffer is reused for every request: re-reading a 4 MiB file
 * per request would put the harness's own I/O inside the measurement.
 */
export async function buildFixtures({
  sizes,
  outDir,
  maxBytes = DEFAULT_MAX_FIXTURE_BYTES,
  spawn = spawnSync,
  read = readFile,
  environment = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C' },
} = {}) {
  const result = spawn(
    'python3',
    [GENERATOR, '--out', outDir, '--sizes', sizes.join(',')],
    {
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (result.status !== 0)
    throw new FixtureError(
      'fixture_generation_failed',
      `make-upload-fixtures.py exited ${result.status}: ${String(
        result.stderr ?? '',
      )
        .trim()
        .slice(0, 400)}`,
    )

  const entries = assertFixtureBounds(
    parseFixtureManifest(String(result.stdout ?? ''), { sizes }),
    { maxBytes },
  )

  const withContent = []
  for (const entry of entries) {
    const content = await read(entry.path)
    if (content.byteLength !== entry.bytes)
      throw new FixtureError(
        'fixture_size_mismatch',
        `Fixture "${entry.size}" is ${content.byteLength} bytes on disk but the manifest said ${entry.bytes}.`,
      )
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== entry.sha256)
      throw new FixtureError(
        'fixture_digest_mismatch',
        `Fixture "${entry.size}" hashes to ${digest}, not the manifest's ${entry.sha256}.`,
      )
    withContent.push({ ...entry, content })
  }
  return withContent
}

/** The filename the upload declares, carrying the fixture's own identity. */
export function fixtureFilename(entry) {
  return `load-fixture-${entry.size}.docx`
}

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
