import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'

async function zipParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const parts = new Map<string, string>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      parts.set(name, await file.async('string'))
    }
  }
  return parts
}

async function partSource(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(name)
  if (!file) throw new Error(`Fixture part ${name} is missing.`)
  return file.async('string')
}

/**
 * The shared fixture carries real tracked changes, which the policy refuses.
 * This variant drops the tracked-change markup — but keeps `w:trackRevisions`
 * in settings — so the removal half of the policy is exercised end to end.
 */
async function withoutTrackedChanges() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('Fixture part is missing.')
  const source = (await document.async('string'))
    .replace(/<w:p><w:ins[\s\S]*?<\/w:p>/u, '')
    .replace(/<w:p><w:pPr><w:pPrChange[\s\S]*?<\/w:p>/u, '')
  zip.file('word/document.xml', source)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('share-safe export', () => {
  it('refuses a document that still carries tracked changes', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
    await expect(buildShareSafeDocx(document)).rejects.toThrow(
      'tracked changes',
    )
  })

  it('strips comments, markers, authorship metadata and signatures', async () => {
    const document = await parseDocx(await withoutTrackedChanges())
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)

    // Comment parts and every dangling pointer into them are gone.
    expect(parts.has('word/comments.xml')).toBe(false)
    expect(parts.has('word/_rels/comments.xml.rels')).toBe(false)
    expect(parts.get('word/_rels/document.xml.rels')).not.toContain(
      'relationships/comments',
    )
    expect(parts.get('[Content_Types].xml')).not.toContain('comments.xml')
    const story = parts.get('word/document.xml')
    if (story === undefined) throw new Error('document.xml missing')
    expect(story).not.toContain('commentRangeStart')
    expect(story).not.toContain('commentRangeEnd')
    expect(story).not.toContain('commentReference')
    // The commented run's text, and the footnote/endnote references sharing
    // its sibling run, are content and survive.
    expect(story).toContain('Commented text')
    expect(story).toContain('footnoteReference')
    expect(story).toContain('endnoteReference')

    // Authorship and descriptive metadata are emptied in place.
    expect(parts.get('docProps/core.xml')).toContain(
      '<cp:creator></cp:creator>',
    )
    expect(parts.get('docProps/core.xml')).not.toContain('Alice Example')
    // The signature over the original bytes is void and dropped.
    expect(parts.has('_xmlsignatures/sig1.xml')).toBe(false)
    // Track-changes-on is not inherited by the recipient.
    expect(parts.get('word/settings.xml')).not.toContain('trackRevisions')
    // Visible content is untouched.
    expect(story).toContain('Alice Example overview')
  })

  it('keeps the product markings while dropping foreign custom properties', async () => {
    const zip = await JSZip.loadAsync(await withoutTrackedChanges())
    const custom = await zip.file('docProps/custom.xml')?.async('string')
    if (custom === undefined) throw new Error('Fixture part is missing.')
    zip.file(
      'docProps/custom.xml',
      custom.replace(
        '/>',
        '><property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="obiter.privileged"><vt:bool xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">true</vt:bool></property>' +
          '<property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="3" name="dms.matterRef"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">DMS-44</vt:lpwstr></property></Properties>',
      ),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const bytes = await buildShareSafeDocx(document)
    const out = await partSource(bytes, 'docProps/custom.xml')
    expect(out).toContain('obiter.privileged')
    expect(out).not.toContain('dms.matterRef')
  })

  it('refuses hidden text rather than guessing at it', async () => {
    const zip = await JSZip.loadAsync(await withoutTrackedChanges())
    const document = zip.file('word/document.xml')
    if (!document) throw new Error('Fixture part is missing.')
    zip.file(
      'word/document.xml',
      (await document.async('string')).replace(
        '<w:r><w:t>Restarted list</w:t></w:r>',
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Secret</w:t></w:r><w:r><w:t>Restarted list</w:t></w:r>',
      ),
    )
    const parsed = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    await expect(buildShareSafeDocx(parsed)).rejects.toThrow('hidden text')
  })

  it('refuses embedded packages it cannot inspect', async () => {
    const zip = await JSZip.loadAsync(await withoutTrackedChanges())
    zip.file('word/embeddings/oleObject1.bin', new Uint8Array([1, 2, 3]))
    const parsed = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    await expect(buildShareSafeDocx(parsed)).rejects.toThrow('embeddings/')
  })

  it('produces a package that itself re-parses as share-safe', async () => {
    const document = await parseDocx(await withoutTrackedChanges())
    const bytes = await buildShareSafeDocx(document)
    const reparsed = await parseDocx(bytes)
    expect(reparsed.model.comments).toHaveLength(0)
    expect(reparsed.model.changes).toHaveLength(0)
    const text = reparsed.model.stories[0]?.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join('')
    expect(text).toContain('Commented text')
    expect(text).toContain('Alice Example overview')
  })
})
