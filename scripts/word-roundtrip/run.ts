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
 *   - A supplied --word-output is not trusted at face value: the file must
 *     differ from the fixture and the cycle-1 export, carry the same body
 *     text, parse as a DOCX, and name Microsoft Office Word as its
 *     docProps/app.xml producer. That earns `manual-reported` evidence, never
 *     a verified gate: app.xml is operator-mutable, so `wordAcceptance`
 *     stays `not-checked` until recorded external evidence — open without
 *     repair, save, visual comparison — exists.
 *
 * Lane safety (scripts/word-roundtrip/lane.ts): both origins must be
 * loopback, neither may sit on the shared dev ports 8787/3000, --db-name must
 * name the `*_test` database the API reports itself bound to, and the API's
 * development provenance must match this checkout at HEAD — the same lane
 * contract the Playwright journey enforces.
 *
 * The fixture is synthetic throughout (the repo's full-fidelity OOXML
 * fixture): no client or real legal text is involved.
 *
 * Usage:
 *   bun scripts/word-roundtrip/run.ts --api http://127.0.0.1:8797 \
 *     --web http://localhost:3005 --db-name obiter_e0_test \
 *     --out /tmp/word-roundtrip
 *
 * After completing the Word step:
 *   bun scripts/word-roundtrip/run.ts --api ... --web ... --out /tmp/word-roundtrip \
 *     --db-name ... --word-output /tmp/word-roundtrip/word-saved.docx \
 *     --word-version "Microsoft Word for Microsoft 365, version 2405"
 *
 * A manifest.json is always written under --out recording provenance,
 * artifact hashes, the word step's status, and the semantic comparison.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { createClient } from './api-client'
import { parseArgs } from './args'
import { resolveLane } from './lane'
import { createRunManifest, sha256 } from './manifest'
import { compare, summarise } from './summary'
import {
  detectWord,
  inspectWordOutput,
  wordRecord,
  wordStepInstructions,
} from './word-step'

const args = parseArgs(process.argv.slice(2))
if (!args.api || !args.web) {
  console.error(
    'Required: --api <loopback origin> --web <loopback origin> --db-name <*_test> [--email --password]',
  )
  process.exit(2)
}

const outDir = path.resolve(args.out)
mkdirSync(outDir, { recursive: true })

// Lane refusal precedes the manifest: a run that cannot name its isolated
// targets must exit before any artifact, account or document exists.
let lane: Awaited<ReturnType<typeof resolveLane>>
try {
  lane = await resolveLane({
    api: args.api,
    web: args.web,
    dbName: args.dbName,
  })
} catch (error) {
  console.error(
    `FAIL: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}

const { manifest, record, fail, write } = createRunManifest(outDir, {
  api: lane.apiOrigin,
  git: lane.headSha,
  databaseName: lane.databaseName,
  apiCommitSha: lane.api.commitSha,
  apiCheckoutRoot: lane.api.checkoutRoot,
})
const client = createClient({
  apiOrigin: lane.apiOrigin,
  webOrigin: lane.webOrigin,
  fail,
})

const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
record('input-synthetic.docx', fixture)

const { cookie } = await client.createAccount({
  email: args.email,
  password: args.password,
  databaseName: lane.databaseName,
})
const matterId = await client.createMatter(cookie)

const firstId = await client.upload(
  cookie,
  matterId,
  'word-roundtrip-input.docx',
  fixture,
)
await client.waitReady(cookie, firstId)
const firstExport = await client.exportDocx(cookie, firstId)
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
  const id = await client.upload(cookie, matterId, `${name}.docx`, bytes)
  await client.waitReady(cookie, id)
  const exported = await client.exportDocx(cookie, id)
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
  writeFileSync(path.join(outDir, 'word-step.md'), wordStepInstructions(probe))
  manifest.result = 'awaiting-word-step'
  write()
  console.log(`Word step pending — see ${path.join(outDir, 'word-step.md')}`)
  process.exit(0)
}

// `fail` exits, so the `||` is a guard, not a default: an absent or empty
// version never reaches the record — the manifest needs the claimed build.
const wordVersion =
  args.wordVersion ||
  fail(
    '--word-output requires --word-version so the manifest records real Word provenance',
  )
const wordBytes = new Uint8Array(readFileSync(path.resolve(args.wordOutput)))

// The file carries evidence, not proof: it must differ from the inputs,
// carry the same body text, and name the Word producer before it reaches
// the upload step at all.
const evidence = await inspectWordOutput(wordBytes, {
  fixtureSha256: sha256(fixture),
  cycle1Sha256: sha256(firstExport),
  cycle1BodyText: firstSummary.bodyText,
})
const correlatedWith = {
  artifact: 'cycle-1-obiter-export.docx',
  sha256: sha256(firstExport),
}
manifest.word = wordRecord(evidence, wordVersion, correlatedWith)
if (evidence.status === 'rejected') {
  manifest.result = `fail: word output rejected — ${evidence.reason}`
  write()
  console.error(`FAIL: word output rejected — ${evidence.reason}`)
  process.exit(1)
}
record('word-saved.docx', wordBytes)

const secondId = await client.upload(
  cookie,
  matterId,
  'word-roundtrip-word-saved.docx',
  wordBytes,
)
await client.waitReady(cookie, secondId)
const secondExport = await client.exportDocx(cookie, secondId)
record('cycle-2-obiter-export.docx', secondExport)
const secondSummary = await summarise(secondExport)

const checks = compare(firstSummary, secondSummary)
const semanticPass = checks.every((check) => check.pass)
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
  ? 'cycles-passed'
  : 'fail: semantic comparison found differences'
write()

for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name} — ${check.detail}`)
}
console.log(`manifest: ${path.join(outDir, 'manifest.json')}`)
process.exit(semanticPass ? 0 : 1)
