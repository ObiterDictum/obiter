import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import {
  comment,
  requiredXml,
  withoutCommentsPackageSupport,
  zipParts,
} from './comments-export.test-support'
import { parseDocx, serialiseDocxWithComments } from './index'

describe('product comment package export', () => {
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

  it('inserts two product relationships into a rels part that already has entries', async () => {
    // A resolved comment emits a commentsExtended entry, so one export asks
    // for two insertions into word/_rels/document.xml.rels. The fixture part
    // carries nine relationships already; the second insertion's position
    // must be taken in source coordinates — the serialised view has shifted
    // by then — or the part comes back malformed.
    const input = await withoutCommentsPackageSupport()
    const source = requiredXml(
      await zipParts(input),
      'word/_rels/document.xml.rels',
    )
    const existing = source.match(/<Relationship /gu)?.length ?? 0
    expect(existing).toBeGreaterThan(1)

    const document = await parseDocx(input)
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      {
        ...comment('cmt_done', paragraph.id, 0, 5, 'Resolved comment'),
        resolvedAt: '2026-08-11T09:00:00.000Z',
        resolvedBy: 'usr_1',
      },
    ])
    const relationships = requiredXml(
      await zipParts(output),
      'word/_rels/document.xml.rels',
    )

    expect(relationships.match(/<Relationship /gu)).toHaveLength(existing + 2)
    expect(relationships).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"',
    )
    expect(relationships).toContain(
      'Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"',
    )
    for (const id of source.matchAll(/Id="(rId\d+)"/gu)) {
      expect(relationships).toContain(`Id="${id[1]}"`)
    }

    // The finished package must still load: malformed rels XML is a hard
    // failure here, not a silently dropped part.
    const reparsed = await parseDocx(output)
    expect(
      reparsed.model.relationships.filter(
        (relationship) => relationship.sourcePartName === 'word/document.xml',
      ),
    ).toHaveLength(existing + 2)
  })

  it('inserts two product relationships into a self-closing rels root', async () => {
    // A rels part whose root is `<Relationships .../>` is legal but carries no
    // children: both product relationships must land inside the one expansion
    // replacement, or two whole-root replacements overlap and serialisation
    // throws. The foreign namespace attribute proves the rewrite preserves
    // the root's original attributes.
    const zip = await JSZip.loadAsync(await withoutCommentsPackageSupport())
    zip.file(
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:obt="urn:obiter:test" obt:marker="kept"/>',
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      {
        ...comment('cmt_self_closing_rels', paragraph.id, 0, 5, 'Done comment'),
        resolvedAt: '2026-08-11T09:00:00.000Z',
        resolvedBy: 'usr_1',
      },
    ])
    const relationships = requiredXml(
      await zipParts(output),
      'word/_rels/document.xml.rels',
    )

    expect(relationships.match(/<Relationships/gu)).toHaveLength(1)
    expect(relationships).toContain('</Relationships>')
    expect(relationships).toContain('obt:marker="kept"')
    expect(relationships.match(/<Relationship /gu)).toHaveLength(2)
    expect(relationships).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"',
    )
    expect(relationships).toContain(
      'Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"',
    )

    const reparsed = await parseDocx(output)
    expect(
      reparsed.model.relationships.filter(
        (relationship) => relationship.sourcePartName === 'word/document.xml',
      ),
    ).toHaveLength(2)
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
})
