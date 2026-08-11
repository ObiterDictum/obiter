import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { DocumentComment } from '@obiter/contracts'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  compareOoxmlProductCommentExport,
  parseDocx,
  parseModelJson,
  serialiseDocxWithComments,
  serialiseModelJson,
  type ComparableOoxmlPackage,
  type OoxmlDocument,
} from './index'

const decoder = new TextDecoder()

describe('product comment DOCX export', () => {
  it('keeps a stable anchor through the model JSON round-trip', async () => {
    const document = await fixtureDocument()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const anchor = {
      paragraphId: paragraph.id,
      startOffset: 6,
      endOffset: 13,
    }

    const model = parseModelJson(serialiseModelJson(document))
    const roundTrippedParagraph = model.stories
      .flatMap((story) => story.paragraphs)
      .find(({ id }) => id === anchor.paragraphId)

    expect(roundTrippedParagraph?.id).toBe(anchor.paragraphId)
    expect(
      roundTrippedParagraph?.runs
        .map((run) => run.text)
        .join('')
        .slice(6, 13),
    ).toBe('Example')
  })

  it('places ranges within a run, across runs, and at an insertion anchor', async () => {
    const document = await fixtureDocument()
    const first = document.model.stories[0]?.paragraphs[0]
    const across = document.model.stories
      .flatMap((story) => story.paragraphs)
      .find((paragraph) => paragraph.runs.length >= 2)
    if (!first || !across) throw new Error('Fixture paragraphs are missing.')
    const firstRunLength = across.runs[0]?.text.length ?? 0

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_within', first.id, 6, 13, 'Within one run'),
      comment(
        'cmt_across',
        across.id,
        Math.max(0, firstRunLength - 4),
        firstRunLength + 4,
        'Across runs',
      ),
      comment('cmt_zero', first.id, 0, 0, 'Insertion point'),
    ])
    const parts = await zipParts(output)
    const story = requiredXml(parts, 'word/document.xml')

    expect(story).toContain('<w:commentRangeStart w:id="2"/><w:r><w:t>Exam')
    expect(story).toContain('ple</w:t></w:r><w:commentRangeEnd w:id="2"/>')
    expect(story).toContain('<w:commentRangeStart w:id="1"/><w:r><w:t>ence')
    expect(story).toContain('Jane</w:t></w:r><w:commentRangeEnd w:id="1"/>')
    expect(story).toContain(
      '<w:commentRangeStart w:id="3"/><w:commentRangeEnd w:id="3"/>',
    )
    for (const id of [1, 2, 3]) {
      expect(story).toContain(`<w:commentReference w:id="${id}"/>`)
    }
  })

  it('retains run properties and preserved fragments when splitting a run', async () => {
    const document = await documentWithRunProperties()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_properties', paragraph.id, 6, 13, 'Styled range'),
    ])
    const story = requiredXml(await zipParts(output), 'word/document.xml')

    expect(story.match(/<w:rPr><w:b\/><\/w:rPr>/gu)).toHaveLength(4)
    expect(story.match(/<w:noBreakHyphen\/>/gu)).toHaveLength(1)
  })

  it('preserves foreign comments and allocates deterministic non-colliding ids', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const resolvedComment = {
      ...comment('cmt_z', paragraph.id, 0, 5, 'Later id'),
      resolvedAt: '2026-08-10T13:00:00.000Z',
      resolvedBy: 'usr_2',
    }
    const output = await serialiseDocxWithComments(document, [
      resolvedComment,
      comment('cmt_a', paragraph.id, 6, 13, 'Earlier id'),
    ])
    const inputParts = await zipParts(input)
    const outputParts = await zipParts(output)
    const comments = requiredXml(outputParts, 'word/comments.xml')

    expect(comments).toContain('<w:comment w:id="0" w:author="Alice Example"')
    expect(comments).toContain('Fictional review comment')
    expect(comments).toContain('<w:comment w:id="1"')
    expect(comments).toContain('Earlier id')
    expect(comments).toContain('<w:comment w:id="2"')
    expect(comments).toContain('Later id')
    expect(comments.indexOf('Fictional review comment')).toBeLessThan(
      comments.indexOf('Earlier id'),
    )

    for (const [name, bytes] of inputParts) {
      if (name === 'word/document.xml' || name === 'word/comments.xml') continue
      expect(outputParts.get(name), name).toEqual(bytes)
    }
  })

  it('satisfies intentional touched-part equivalence', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const output = await serialiseDocxWithComments(document, [
      comment('cmt_equivalent', paragraph.id, 0, 0, 'Product review'),
    ])
    const sourceParts = await zipParts(input)
    const outputParts = await zipParts(output)
    const reference =
      '<w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>'
    const productComment =
      '<w:comment w:id="1" w:author="Sol Reviewer" w:date="2026-08-10T12:00:00.000Z"><w:p><w:r><w:t xml:space="preserve">Product review</w:t></w:r></w:p></w:comment>'
    const expectedTouched = new Map([
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

    expect(
      compareOoxmlProductCommentExport(
        comparablePackage(document, sourceParts),
        comparablePackage(document, outputParts),
        expectedTouched,
      ),
    ).toEqual({ equivalent: true })
  })

  it('creates a missing comments part, relationship, and content type', async () => {
    const input = await withoutCommentsPackageSupport()
    const document = await parseDocx(input)
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_new', paragraph.id, 0, 5, 'New comment'),
    ])
    const parts = await zipParts(output)

    expect(requiredXml(parts, 'word/comments.xml')).toContain('New comment')
    expect(requiredXml(parts, 'word/_rels/document.xml.rels')).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"',
    )
    expect(requiredXml(parts, '[Content_Types].xml')).toContain(
      'PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"',
    )
  })

  it('creates the document relationship part when it is absent', async () => {
    const zip = await JSZip.loadAsync(await withoutCommentsPackageSupport())
    zip.remove('word/_rels/document.xml.rels')
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_new_relationships', paragraph.id, 0, 0, 'New comment'),
    ])
    const relationships = requiredXml(
      await zipParts(output),
      'word/_rels/document.xml.rels',
    )

    expect(relationships).toContain('<Relationships')
    expect(relationships).toContain('relationships/comments')
  })

  it('appends to an existing self-closing comments root', async () => {
    const zip = await JSZip.loadAsync(await withoutCommentsPackageSupport())
    zip.file(
      'word/comments.xml',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    )
    const relationships = zip.file('word/_rels/document.xml.rels')
    if (!relationships) throw new Error('Fixture part is missing.')
    zip.file(
      'word/_rels/document.xml.rels',
      (await relationships.async('string')).replace(
        '</Relationships>',
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>',
      ),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_self_closing', paragraph.id, 0, 0, 'Visible comment'),
    ])
    const comments = requiredXml(await zipParts(output), 'word/comments.xml')

    expect(comments).toContain('Visible comment')
    expect(comments).toContain('</w:comments>')
  })

  it('escapes author and body text and preserves line breaks as Word markup', async () => {
    const document = await fixtureDocument()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const escaped = {
      ...comment(
        'cmt_escape',
        paragraph.id,
        0,
        5,
        'First <line> & "quoted"\nSecond line',
      ),
      author: { id: 'usr_1', name: 'A & B "Review"' },
    }

    const output = await serialiseDocxWithComments(document, [escaped])
    const comments = requiredXml(await zipParts(output), 'word/comments.xml')

    expect(comments).toContain('w:author="A &amp; B &quot;Review&quot;"')
    expect(comments).toContain('First &lt;line&gt; &amp; "quoted"')
    expect(comments).toContain(
      '</w:t><w:br/><w:t xml:space="preserve">Second line',
    )
    expect(comments).not.toContain('cmt_escape')
  })

  it('resolves anchors in every parsed story part', async () => {
    const document = await fixtureDocument()
    const comments = document.model.stories.map((story, index) => {
      const paragraph = story.paragraphs.find((candidate) =>
        candidate.runs.some((run) => run.text.length > 0),
      )
      if (!paragraph) throw new Error('Fixture story paragraph is missing.')
      return comment(`cmt_story_${index}`, paragraph.id, 0, 0, `Story ${index}`)
    })

    const output = await serialiseDocxWithComments(document, comments)
    const parts = await zipParts(output)
    for (const story of document.model.stories) {
      expect(requiredXml(parts, story.partName)).toContain(
        '<w:commentRangeStart',
      )
    }
  })

  it('rejects surrogate splits and unresolved paragraph ids without leaking comment text', async () => {
    const document = await documentWithEmoji()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const privateBody = 'private comment marker'

    for (const invalid of [
      comment('cmt_unicode', paragraph.id, 1, 2, privateBody),
      comment('cmt_range', paragraph.id, 0, 999, privateBody),
      comment('cmt_missing', 'para-missing', 0, 0, privateBody),
    ]) {
      try {
        await serialiseDocxWithComments(document, [invalid])
        throw new Error('Expected comment export to fail.')
      } catch (error) {
        expect(error).toMatchObject({
          name: 'OoxmlError',
          code: 'comment-anchor-unresolved',
          message: 'A document comment anchor could not be resolved.',
        })
        expect(String(error)).not.toContain(privateBody)
      }
    }
  })

  it('does not mutate the model, source parts, overlays, or comment records', async () => {
    const document = await fixtureDocument()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const comments = [comment('cmt_immutable', paragraph.id, 0, 5, 'Review')]
    const before = documentState(document, comments)

    await serialiseDocxWithComments(document, comments)

    expect(documentState(document, comments)).toEqual(before)
  })

  it('keeps the empty-comment export on the clean byte-identity path', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const output = await serialiseDocxWithComments(document, [])
    const inputParts = await zipParts(input)
    const outputParts = await zipParts(output)

    expect(outputParts).toEqual(inputParts)
  })
})

function comment(
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

async function fixtureDocument() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

async function withoutCommentsPackageSupport() {
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

async function documentWithRunProperties() {
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

async function documentWithEmoji() {
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

async function zipParts(bytes: Uint8Array) {
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

function requiredXml(parts: ReadonlyMap<string, Uint8Array>, name: string) {
  const bytes = parts.get(name)
  if (!bytes) throw new Error('Fixture part is missing.')
  return decoder.decode(bytes)
}

function comparablePackage(
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

function documentState(
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
