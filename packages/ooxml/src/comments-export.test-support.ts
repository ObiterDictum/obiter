import JSZip from 'jszip'
import type { DocumentComment } from '@obiter/contracts'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  parseDocx,
  type ComparableOoxmlPackage,
  type OoxmlDocument,
} from './index'

const decoder = new TextDecoder()

export function comment(
  id: string,
  paragraphId: string,
  startOffset: number,
  endOffset: number,
  body: string,
): DocumentComment {
  return {
    id,
    documentId: 'doc_1',
    anchorVersionId: 'ver_1',
    anchor: { paragraphId, startOffset, endOffset },
    body,
    author: { id: 'usr_1', name: 'Sol Reviewer' },
    resolvedAt: null,
    resolvedBy: null,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
  }
}

export async function fixtureDocument() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

export async function withoutCommentsPackageSupport() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.remove('word/comments.xml')
  zip.remove('word/_rels/comments.xml.rels')
  const relationships = zip.file('word/_rels/document.xml.rels')
  const contentTypes = zip.file('[Content_Types].xml')
  if (!relationships || !contentTypes)
    throw new Error('Fixture part is missing.')
  zip.file(
    'word/_rels/document.xml.rels',
    (await relationships.async('string')).replace(
      /\s*<Relationship Id="rId9"[^>]+\/>/u,
      '',
    ),
  )
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('Fixture part is missing.')
  zip.file(
    'word/document.xml',
    (await document.async('string'))
      .replace('<w:commentRangeStart w:id="0"/>', '')
      .replace('<w:commentRangeEnd w:id="0"/>', '')
      .replace('<w:commentReference w:id="0"/>', ''),
  )
  zip.file(
    '[Content_Types].xml',
    (await contentTypes.async('string')).replace(
      /\s*<Override PartName="\/word\/comments\.xml"[^>]+\/>/u,
      '',
    ),
  )
  return zip.generateAsync({ type: 'uint8array' })
}

export async function documentWithRunProperties() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('Fixture part is missing.')
  zip.file(
    'word/document.xml',
    (await part.async('string')).replace(
      '<w:r><w:t>Alice Example overview</w:t></w:r>',
      '<w:r><w:rPr><w:b/></w:rPr><w:noBreakHyphen/><w:t>Alice Example overview</w:t></w:r>',
    ),
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

export async function documentWithEmoji() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('Fixture part is missing.')
  zip.file(
    'word/document.xml',
    (await part.async('string')).replace(
      'Alice Example overview',
      '😀 Alice Example overview',
    ),
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

export async function zipParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  return new Map(
    await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map(
          async (entry) =>
            [entry.name, await entry.async('uint8array')] as const,
        ),
    ),
  )
}

export function requiredXml(
  parts: ReadonlyMap<string, Uint8Array>,
  name: string,
) {
  const bytes = parts.get(name)
  if (!bytes) throw new Error('Fixture part is missing.')
  return decoder.decode(bytes)
}

export function comparablePackage(
  document: OoxmlDocument,
  parts: ReadonlyMap<string, Uint8Array>,
): ComparableOoxmlPackage {
  return new Map(
    [...parts].map(([name, bytes]) => [
      name,
      document.sourceParts.get(name)?.kind === 'xml'
        ? { kind: 'xml', xml: decoder.decode(bytes) }
        : { kind: 'binary', bytes },
    ]),
  )
}

export function expectedTouchedCommentParts(
  sourceParts: ReadonlyMap<string, Uint8Array>,
) {
  const reference =
    '<w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>'
  const productComment =
    '<w:comment w:id="1" w:author="Sol Reviewer" w:date="2026-08-10T12:00:00.000Z"><w:p><w:r><w:t xml:space="preserve">Product review</w:t></w:r></w:p></w:comment>'
  return new Map([
    [
      'word/document.xml',
      requiredXml(sourceParts, 'word/document.xml').replace(
        '<w:r><w:t>Alice Example overview</w:t></w:r>',
        `${reference}<w:r><w:t>Alice Example overview</w:t></w:r>`,
      ),
    ],
    [
      'word/comments.xml',
      requiredXml(sourceParts, 'word/comments.xml').replace(
        '</w:comments>',
        `${productComment}</w:comments>`,
      ),
    ],
  ])
}

export function documentState(
  document: OoxmlDocument,
  comments: readonly DocumentComment[],
) {
  return {
    model: JSON.stringify(document.model),
    sourceParts: [...document.sourceParts].map(([name, part]) => ({
      name,
      dirty: part.dirty,
      source: part.overlay?.source,
      replacements: part.overlay
        ? [...part.overlay.replacements.entries()]
        : undefined,
      bytes: [...part.originalPayload],
    })),
    comments: JSON.stringify(comments),
  }
}
