import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { createClient } from './api-client'
import { parseArgs } from './args'
import { planCycle2Edit } from './cycle2-edit'
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

const wordVersion =
  args.wordVersion ||
  fail(
    '--word-output requires --word-version so the manifest records real Word provenance',
  )
const wordBytes = new Uint8Array(readFileSync(path.resolve(args.wordOutput)))

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

const modelResponse = await client.getModel(cookie, secondId)
const planned =
  planCycle2Edit(modelResponse.model) ??
  fail(
    'the cycle-2 document model exposes no plainly editable body run — ' +
      'the required edit leg cannot proceed',
  )
const edited = await client.editDocument(cookie, secondId, {
  baseVersionId: modelResponse.versionId,
  operations: [planned.operation],
})
manifest.cycle2Edit = {
  baseVersionId: modelResponse.versionId,
  editedVersionId: edited.versionId,
  editedVersionNumber: edited.versionNumber,
  operations: [planned.operation],
  expectedBodySha256: sha256(
    new TextEncoder().encode(planned.expectedBodyText),
  ),
}
console.log(
  `cycle-2 edit: ${planned.operation.type} on run ${planned.runId} ` +
    `committed version ${String(edited.versionNumber)}`,
)

const secondExport = await client.exportDocx(cookie, secondId)
record('cycle-2-obiter-export.docx', secondExport)
const secondSummary = await summarise(secondExport)

const checks = compare(firstSummary, secondSummary, {
  bodyText: planned.expectedBodyText,
})
const semanticPass = checks.every((check) => check.pass)
manifest.cycle2 = {
  documentId: secondId,
  summary: { ...secondSummary, bodyText: undefined },
}
manifest.semanticComparison = {
  scope:
    'ooxml-level: body text expected as cycle-1 text plus the applied cycle-2 edit, paragraph and story counts, fields, styles, numbering, images, comments, tracked changes, footnotes and endnotes, source-part preservation by part identity and role, package part additions, and relationship bindings by multiplicity. Visual fidelity inside Word is an operator observation, not this check.',
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
