import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { createOpaquePart } from '../../packages/ooxml/src/parts/opaque'
import { serialiseDocx } from '../../packages/ooxml/src/serialise'
import { isolatedOrigin, testDatabaseName } from './lane'
import { sha256 } from './manifest'
import { inspectWordOutput } from './word-step'

const encoder = new TextEncoder()

function appXml(application: string | null) {
  return `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${
    application === null ? '' : `<Application>${application}</Application>`
  }<AppVersion>16.0000</AppVersion></Properties>`
}

/** A serialised copy of the fixture, optionally carrying a doctored app.xml. */
async function docxWithApplication(application: string | null | undefined) {
  const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const doc = await parseDocx(fixture)
  if (application !== undefined) {
    doc.sourceParts.set(
      'docProps/app.xml',
      createOpaquePart(
        'docProps/app.xml',
        'xml',
        encoder.encode(appXml(application)),
      ),
    )
  }
  return { fixture, bytes: await serialiseDocx(doc) }
}

describe('word-roundtrip lane targets', () => {
  it('refuses the shared dev ports on either origin', () => {
    expect(() => isolatedOrigin('http://127.0.0.1:8787', 'API')).toThrow(
      /shared dev stack/,
    )
    expect(() => isolatedOrigin('http://localhost:3000', 'Web')).toThrow(
      /shared dev stack/,
    )
  })

  it('refuses non-loopback hosts', () => {
    expect(() => isolatedOrigin('https://api.example.com', 'API')).toThrow(
      /loopback/,
    )
  })

  it('accepts an isolated loopback origin', () => {
    expect(isolatedOrigin('http://127.0.0.1:8797', 'API').origin).toBe(
      'http://127.0.0.1:8797',
    )
  })

  it('requires a *_test database and refuses the shared one', () => {
    expect(() => testDatabaseName(undefined)).toThrow(/--db-name/)
    expect(() => testDatabaseName('obiter')).toThrow(/shared dev database/)
    expect(() => testDatabaseName('obiter_e0')).toThrow(/_test/)
    expect(testDatabaseName('obiter_e0_test')).toBe('obiter_e0_test')
  })
})

describe('word-roundtrip Word producer evidence', () => {
  it('rejects the input fixture passed back as the Word output', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const evidence = await inspectWordOutput(fixture, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('input fixture')
  })

  it('rejects the cycle-1 export passed back as the Word output', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-without-w14-ids')
    const evidence = await inspectWordOutput(fixture, {
      fixtureSha256: 'other',
      cycle1Sha256: sha256(fixture),
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('cycle-1')
  })

  it('rejects a package with no docProps/app.xml', async () => {
    const { fixture, bytes } = await docxWithApplication(undefined)
    const evidence = await inspectWordOutput(bytes, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('docProps/app.xml')
  })

  it('rejects a non-Word producer (LibreOffice)', async () => {
    const { fixture, bytes } = await docxWithApplication('LibreOffice/24.2')
    const evidence = await inspectWordOutput(bytes, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('LibreOffice/24.2')
    expect(evidence.producer).toBe('LibreOffice/24.2')
  })

  it('rejects a package whose app.xml names no producer', async () => {
    const { fixture, bytes } = await docxWithApplication(null)
    const evidence = await inspectWordOutput(bytes, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('producer')
  })

  it('rejects bytes that are not a DOCX at all', async () => {
    const evidence = await inspectWordOutput(encoder.encode('not a docx'), {
      fixtureSha256: 'a',
      cycle1Sha256: 'b',
    })
    expect(evidence.status).toBe('rejected')
    expect(evidence.reason).toContain('parse')
  })

  it('accepts a package naming Microsoft Office Word', async () => {
    const { fixture, bytes } = await docxWithApplication(
      'Microsoft Office Word',
    )
    const evidence = await inspectWordOutput(bytes, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
    })
    expect(evidence.status).toBe('checked')
    expect(evidence.producer).toBe('Microsoft Office Word')
    expect(evidence.appVersion).toBe('16.0000')
    expect(evidence.inputSha256).toBe(sha256(bytes))
  })
})
