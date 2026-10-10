/**
 * E13/P0-1 — Microsoft Word round-trip harness.
 *
 * What this proves, and what it does not:
 *
 *   - The Obiter half is fully automated: the synthetic full-fidelity fixture
 *     is built deterministically, uploaded through the real API, exported,
 *     hashed, and — once a Word-saved file exists — re-uploaded and
 *     re-exported, with an OOXML-level semantic comparison between the two
 *     exports.
 *   - The Microsoft Word half is an honest operator step. This script detects
 *     whether a real Word installation is reachable; when it is not, it writes
 *     `word-step.md` with the manual open/save instructions and records
 *     `word.status: "not-checked"` in the manifest. LibreOffice is detected
 *     and reported as NOT Word — it never substitutes for the acceptance
 *     gate.
 *
 * The fixture is synthetic throughout (the repo's full-fidelity OOXML
 * fixture): no client or real legal text is involved.
 *
 * Usage:
 *   bun scripts/word-roundtrip/run.ts --api http://localhost:8787 \
 *     --web http://localhost:3000 --db-name obiter_e13_test \
 *     --out /tmp/word-roundtrip
 *
 * After completing the Word step:
 *   bun scripts/word-roundtrip/run.ts --api ... --web ... --out /tmp/word-roundtrip \
 *     --word-output /tmp/word-roundtrip/word-saved.docx \
 *     --word-version "Microsoft Word for Microsoft 365, version 2405"
 *
 * A manifest.json is always written under --out recording provenance,
 * artifact hashes, the word step's status, and the semantic comparison.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { parseDocx } from '../../packages/ooxml/src/parse'
import { paragraphOutlineLevel } from '../../packages/ooxml/src/table-of-contents-entries'
import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'

type Args = {
  api?: string
  web?: string
  out: string
  dbName?: string
  email?: string
  password?: string
  wordOutput?: string
  wordVersion?: string
}

const KNOWN_FLAGS = new Set([
  'api',
  'web',
  'out',
  'dbName',
  'email',
  'password',
  'wordOutput',
  'wordVersion',
])

function parseArgs(argv: string[]): Args {
  const args: Args = { out: '/tmp/word-roundtrip' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith('--') || value === undefined) continue
    index += 1
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    if (!KNOWN_FLAGS.has(key)) continue
    // SAFETY: `key` is whitelisted against KNOWN_FLAGS, which names every
    // optional Args property verbatim.
    args[key as keyof Args] = value
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (!args.api || !args.web) {
  console.error(
    'Required: --api <origin> --web <origin> [--db-name|--email --password]',
  )
  process.exit(2)
}
const apiOrigin = args.api.replace(/\/$/, '')
const webOrigin = args.web.replace(/\/$/, '')
const outDir = path.resolve(args.out)
mkdirSync(outDir, { recursive: true })

/**
 * The acceptance record: provenance, artifact hashes, the Word leg's status
 * and the semantic comparison. Written at every exit — pass, fail and
 * awaiting the operator step alike — so an interrupted run is still honest
 * about how far it got.
 */
type RoundtripManifest = {
  harness: 'word-roundtrip'
  generatedAt: string
  runtime: { bun: string; platform: string }
  api: string
  git: string
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

const manifest: RoundtripManifest = {
  harness: 'word-roundtrip',
  generatedAt: new Date().toISOString(),
  runtime: { bun: Bun.version, platform: process.platform },
  api: apiOrigin,
  git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  artifacts: {},
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function record(name: string, bytes: Uint8Array) {
  const file = path.join(outDir, name)
  writeFileSync(file, bytes)
  manifest.artifacts[name] = { sha256: sha256(bytes), bytes: bytes.length }
  console.log(`wrote ${file} (${String(bytes.length)} bytes)`)
  return file
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  manifest.result = `fail: ${message}`
  writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  process.exit(1)
}

async function request(
  url: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set('Cookie', init.cookie)
  if (!headers.has('Origin')) headers.set('Origin', webOrigin)
  const response = await fetch(`${apiOrigin}${url}`, { ...init, headers })
  return response
}

async function createAccount() {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = args.email ?? `word-rt-${runId}@obiter.test`
  const password = args.password ?? `WordRT-${runId}-Aa1!`
  if (!args.email) {
    const signUp = await request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Word RT User', email, password }),
    })
    if (!signUp.ok) fail(`sign-up failed: ${await signUp.text()}`)
    if (!args.dbName) {
      fail(
        'sign-up requires email verification; pass --db-name so the account can be verified, or --email/--password for an existing account',
      )
    }
    execFileSync('docker', [
      'exec',
      'obiter-postgres',
      'psql',
      '-U',
      'obiter',
      '-d',
      args.dbName,
      '-c',
      `update users set "emailVerified"=true where email='${email.replaceAll("'", "''")}'`,
    ])
  }
  const signIn = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!signIn.ok) fail(`sign-in failed: ${await signIn.text()}`)
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ')
  if (!cookie) fail('sign-in returned no session cookie')
  return { cookie, email }
}

async function createMatter(cookie: string) {
  const response = await request('/api/matters', {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Word round-trip ${Date.now()}`,
      primaryJurisdiction: 'England & Wales',
    }),
  })
  if (!response.ok) fail(`matter create failed: ${await response.text()}`)
  // SAFETY: the response shape is checked through the optional chain and the
  // missing-id branch fails the run below — the cast only narrows to what the
  // API contract already guarantees.
  const body = (await response.json()) as { matter?: { id?: string } }
  const id = body.matter?.id
  if (!id) fail('matter create returned no id')
  return id
}

async function upload(
  cookie: string,
  matterId: string,
  name: string,
  bytes: Uint8Array,
) {
  const form = new FormData()
  // A fresh typed array: readFileSync's Buffer can share a pooled buffer, and
  // sending the pool would corrupt the upload.
  form.set(
    'file',
    new File([new Uint8Array(bytes)], name, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  )
  const response = await request(`/api/matters/${matterId}/documents`, {
    method: 'POST',
    cookie,
    body: form,
  })
  if (!response.ok) fail(`upload failed: ${await response.text()}`)
  // SAFETY: `document?.id` is read defensively and a miss fails the run.
  const body = (await response.json()) as { document?: { id?: string } }
  const id = body.document?.id
  if (!id) fail(`upload returned no document id: ${JSON.stringify(body)}`)
  return id
}

async function waitReady(cookie: string, documentId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(`/api/documents/${documentId}`, { cookie })
    if (!response.ok) fail(`document status failed: ${await response.text()}`)
    // SAFETY: `versions` is read through `(body.versions ?? [])` and every
    // absent or malformed shape fails the ready poll below.
    const body = (await response.json()) as {
      versions?: { documentStatus?: string; failureReason?: string | null }[]
    }
    const statuses = (body.versions ?? []).map((v) => v.documentStatus)
    if (statuses.includes('ready')) return
    if (statuses.includes('failed')) {
      fail(`document processing failed: ${JSON.stringify(body.versions)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  fail('document never reached ready status')
}

async function exportDocx(cookie: string, documentId: string) {
  const response = await request(`/api/documents/${documentId}/export`, {
    cookie,
  })
  if (!response.ok) fail(`export failed: ${await response.text()}`)
  return new Uint8Array(await response.arrayBuffer())
}

type Summary = {
  bodyText: string
  paragraphs: number
  headings: number
  sectionBreaks: number
  storyKinds: string[]
  fields: number
  styles: number
  numberingInstances: number
  imageRelationships: number
  comments: number
  trackedChanges: number
  footnotes: number
  endnotes: number
  opaqueParts: number
}

async function summarise(bytes: Uint8Array): Promise<Summary> {
  const doc = await parseDocx(bytes)
  const model = doc.model
  const storyKinds = model.stories.map((story) => story.kind).sort()
  const documentStory = model.stories.find((story) => story.kind === 'document')
  const textOf = (story: typeof documentStory) =>
    (story?.paragraphs ?? [])
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .join('\n')
  const count = (kind: string) =>
    model.stories.filter((story) => story.kind === kind).length
  const sectionBreaks = (documentStory?.paragraphs ?? []).filter((paragraph) =>
    paragraph.preservedXmlFragments.some((fragment) =>
      fragment.includes('<w:sectPr'),
    ),
  ).length
  return {
    bodyText: textOf(documentStory).replaceAll(/\s+/g, ' ').trim(),
    paragraphs: documentStory?.paragraphs.length ?? 0,
    headings: (documentStory?.paragraphs ?? []).filter(
      (paragraph) =>
        paragraphOutlineLevel(paragraph, model.styles) !== undefined,
    ).length,
    sectionBreaks,
    storyKinds,
    fields: model.stories.reduce(
      (sum, story) => sum + (story.fields?.length ?? 0),
      0,
    ),
    styles: model.styles.length,
    numberingInstances: model.numbering.length,
    imageRelationships: model.relationships.filter((rel) =>
      rel.type.endsWith('/image'),
    ).length,
    comments: model.comments.length,
    trackedChanges: model.changes.length,
    footnotes: count('footnotes'),
    endnotes: count('endnotes'),
    // The package parts preserved byte-for-byte through the pipeline; a drop
    // means the round-trip ate something it could not model.
    opaqueParts: doc.sourceParts.size,
  }
}

function compare(first: Summary, second: Summary) {
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const push = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail })
  push(
    'body text identical',
    first.bodyText === second.bodyText,
    first.bodyText === second.bodyText
      ? `${String(first.bodyText.length)} chars match`
      : `cycle 1: "${first.bodyText.slice(0, 80)}…" vs cycle 2: "${second.bodyText.slice(0, 80)}…"`,
  )
  push(
    'body paragraph count',
    first.paragraphs === second.paragraphs,
    `${String(first.paragraphs)} vs ${String(second.paragraphs)}`,
  )
  push(
    'story kinds preserved',
    JSON.stringify(first.storyKinds) === JSON.stringify(second.storyKinds),
    first.storyKinds.join(', '),
  )
  for (const key of [
    'headings',
    'sectionBreaks',
    'fields',
    'styles',
    'numberingInstances',
    'imageRelationships',
    'comments',
    'trackedChanges',
    'footnotes',
    'endnotes',
    'opaqueParts',
  ] as const) {
    push(
      key,
      first[key] === second[key],
      `${String(first[key])} vs ${String(second[key])}`,
    )
  }
  return checks
}

function detectWord() {
  if (process.platform === 'win32') {
    for (const command of ['WINWORD.EXE', 'winword']) {
      try {
        const found = execFileSync('where', [command], { encoding: 'utf8' })
        if (found.trim()) return { status: 'word-detected', path: found.trim() }
      } catch {
        /* not on PATH */
      }
    }
  } else if (process.platform === 'darwin') {
    try {
      execFileSync(
        'mdfind',
        ['kMDItemCFBundleIdentifier == "com.microsoft.Word"'],
        { stdio: 'pipe' },
      )
      const found = execFileSync(
        'mdfind',
        ['kMDItemCFBundleIdentifier == "com.microsoft.Word"'],
        { encoding: 'utf8' },
      )
      if (found.trim()) return { status: 'word-detected', path: found.trim() }
    } catch {
      /* no Word */
    }
  }
  for (const command of ['libreoffice', 'soffice']) {
    try {
      execFileSync('which', [command], { stdio: 'pipe' })
      return {
        status: 'not-checked',
        reason: `Only ${command} was found; LibreOffice is not Microsoft Word and does not satisfy the gate.`,
      }
    } catch {
      /* continue */
    }
  }
  return {
    status: 'not-checked',
    reason: 'No Microsoft Word installation is reachable on this machine.',
  }
}

const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
record('input-synthetic.docx', fixture)

const { cookie } = await createAccount()
const matterId = await createMatter(cookie)

const firstId = await upload(
  cookie,
  matterId,
  'word-roundtrip-input.docx',
  fixture,
)
await waitReady(cookie, firstId)
const firstExport = await exportDocx(cookie, firstId)
record('cycle-1-obiter-export.docx', firstExport)
const firstSummary = await summarise(firstExport)
manifest.cycle1 = {
  documentId: firstId,
  summary: { ...firstSummary, bodyText: undefined },
}

// The other two manifest fixtures prove their Obiter cycle in the same run:
// the w14-id-free package and the nested-list package each upload and export
// through the same pipeline. Word needs only one rich document for its leg,
// so these record their summaries rather than awaiting an operator.
manifest.obiterCycles = []
for (const name of [
  'full-fidelity-without-w14-ids',
  'multi-level-list',
] as const) {
  const bytes = await buildOoxmlFixture(name)
  const id = await upload(cookie, matterId, `${name}.docx`, bytes)
  await waitReady(cookie, id)
  const exported = await exportDocx(cookie, id)
  const summary = await summarise(exported)
  manifest.obiterCycles.push({
    fixture: name,
    documentId: id,
    byteIdentical: sha256(bytes) === sha256(exported),
    summary: { ...summary, bodyText: undefined },
  })
  console.log(
    `${name}: obiter cycle ${sha256(bytes) === sha256(exported) ? 'byte-identical' : 'diverged'}`,
  )
}

if (!args.wordOutput) {
  const probe = detectWord()
  manifest.word = probe
  writeFileSync(
    path.join(outDir, 'word-step.md'),
    [
      '# Microsoft Word step (manual)',
      '',
      'The Obiter side of the round-trip is complete. To run the Word leg:',
      '',
      '1. Open `cycle-1-obiter-export.docx` in a licensed Microsoft Word',
      '   (Windows or macOS desktop — not Word Online, not LibreOffice).',
      '2. Confirm the document opens without a repair prompt. Note headings,',
      '   lists, tables, images, headers/footers, footnotes and tracked marks.',
      '3. Use File > Save As to write `word-saved.docx` into this directory.',
      '4. Re-run this harness with:',
      '     --word-output <this dir>/word-saved.docx \\',
      '     --word-version "<Word product/version string>"',
      '',
      `Word probe on this machine: ${JSON.stringify(probe)}`,
      '',
    ].join('\n'),
  )
  manifest.result = 'awaiting-word-step'
  writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  console.log(`Word step pending — see ${path.join(outDir, 'word-step.md')}`)
  process.exit(0)
}

if (!args.wordVersion) {
  fail(
    '--word-output requires --word-version so the manifest records real Word provenance',
  )
}
const wordBytes = new Uint8Array(readFileSync(path.resolve(args.wordOutput)))
record('word-saved.docx', wordBytes)

const secondId = await upload(
  cookie,
  matterId,
  'word-roundtrip-word-saved.docx',
  wordBytes,
)
await waitReady(cookie, secondId)
const secondExport = await exportDocx(cookie, secondId)
record('cycle-2-obiter-export.docx', secondExport)
const secondSummary = await summarise(secondExport)

const checks = compare(firstSummary, secondSummary)
const semanticPass = checks.every((check) => check.pass)
manifest.word = {
  status: 'checked',
  version: args.wordVersion,
  inputSha256: sha256(wordBytes),
}
manifest.cycle2 = {
  documentId: secondId,
  summary: { ...secondSummary, bodyText: undefined },
}
manifest.semanticComparison = {
  scope:
    'ooxml-level: body text, paragraph and story counts, fields, styles, numbering, images, comments, tracked changes, footnotes and endnotes. Visual fidelity inside Word is an operator observation, not this check.',
  checks,
  pass: semanticPass,
}
manifest.result = semanticPass
  ? 'pass'
  : 'fail: semantic comparison found differences'
writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
)

for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name} — ${check.detail}`)
}
console.log(`manifest: ${path.join(outDir, 'manifest.json')}`)
process.exit(semanticPass ? 0 : 1)
