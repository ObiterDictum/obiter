import JSZip from 'jszip'
import { expect } from 'bun:test'

import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'

/**
 * Shared hostile-package harness for the share-safe probe suites: build a
 * synthetic DOCX carrying one crafted shape, run the export, and inspect
 * the emitted archive's bytes. Needles are always synthetic `SECRET*`
 * markers — never real content.
 */

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const PKG_R =
  'http://schemas.openxmlformats.org/package/2006/relationships'
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
export const WP =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
export const STRICT_W = 'http://purl.oclc.org/ooxml/wordprocessingml/main'

export interface ProbeSpec {
  /** Extra markup appended to the default document's `w:body`. */
  body?: string
  /** Full `word/document.xml` source, replacing the default. */
  document?: string
  /** `Relationship` markup for `word/_rels/document.xml.rels`. */
  documentRels?: string
  /** Extra `Relationship` markup for `_rels/.rels`. */
  rootRels?: string
  /** Extra parts, name → XML source or binary payload. */
  parts?: Record<string, string | Uint8Array>
  /** Extra `Override` markup for `[Content_Types].xml`. */
  overrides?: string
  /** Extra `Default` markup for `[Content_Types].xml`. */
  defaults?: string
}

export function rel(id: string, tail: string, target: string, extra = '') {
  return `<Relationship Id="${id}" Type="${R}/${tail}" Target="${target}"${extra}/>`
}

export function override(partName: string, tail: string) {
  return `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tail}+xml"/>`
}

export async function probePackage(spec: ProbeSpec): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${spec.defaults ?? ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${spec.overrides ?? ''}</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="${PKG_R}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>${spec.rootRels ?? ''}</Relationships>`,
  )
  zip.file(
    'word/document.xml',
    spec.document ??
      `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:w14="${W14}"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p>${spec.body ?? ''}</w:body></w:document>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_R}">${spec.documentRels ?? ''}</Relationships>`,
  )
  for (const [name, source] of Object.entries(spec.parts ?? {})) {
    zip.file(name, source)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/** The emitted archive as text and binary part maps. */
export async function outputParts(spec: ProbeSpec) {
  const document = await parseDocx(await probePackage(spec))
  const bytes = await buildShareSafeDocx(document)
  const zip = await JSZip.loadAsync(bytes)
  const parts = new Map<string, string>()
  const binary = new Map<string, Uint8Array>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    parts.set(name, await file.async('string'))
    binary.set(name, await file.async('uint8array'))
  }
  return { parts, binary }
}

export async function probeOutput(spec: ProbeSpec) {
  return (await outputParts(spec)).parts
}

/**
 * A clean export: every emitted part is searched for the probe needles,
 * the `Visible.` marker must survive, and the emitted parts come back for
 * further assertions.
 */
export async function expectClean(spec: ProbeSpec, needles: string[]) {
  const { parts, binary } = await outputParts(spec)
  const found: string[] = []
  for (const [name, text] of parts) {
    for (const needle of needles) {
      if (text.includes(needle)) found.push(`${name}:${needle}`)
    }
  }
  for (const [name, bytes] of binary) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    for (const needle of needles) {
      if (text.includes(needle)) found.push(`${name}:${needle}`)
    }
  }
  expect(found).toEqual([])
  expect(parts.get('word/document.xml')).toContain('Visible.')
  return { parts, binary }
}

export async function expectRefusal(spec: ProbeSpec) {
  const document = await parseDocx(await probePackage(spec))
  await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
    ShareSafeRefusal,
  )
}
