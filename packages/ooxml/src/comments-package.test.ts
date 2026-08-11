import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

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
