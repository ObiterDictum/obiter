import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  comment,
  comparablePackage,
  documentState,
  documentWithEmoji,
  documentWithRunProperties,
  documentWithTextWrappingBreak,
  expectedTouchedCommentParts,
  fixtureDocument,
  requiredXml,
  zipParts,
} from './comments-export.test-support'
import {
  compareOoxmlProductCommentExport,
  parseDocx,
  parseModelJson,
  serialiseDocxWithComments,
  serialiseModelJson,
} from './index'

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

    const withinRange = story.match(
      /<w:t xml:space="preserve">(Alice )<\/w:t><\/w:r><w:commentRangeStart w:id="2"\/><w:r><w:t xml:space="preserve">(Example)<\/w:t><\/w:r><w:commentRangeEnd w:id="2"\/><w:r><w:rPr><w:rStyle w:val="CommentReference"\/><\/w:rPr><w:commentReference w:id="2"\/><\/w:r><w:r><w:t xml:space="preserve">( overview)<\/w:t>/u,
    )
    expect(withinRange?.slice(1)).toEqual(['Alice ', 'Example', ' overview'])
    expect(story).toContain(
      '<w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">ence',
    )
    expect(story).toContain('Jane</w:t></w:r><w:commentRangeEnd w:id="1"/>')
    expect(story).toContain(
      '<w:commentRangeStart w:id="3"/><w:commentRangeEnd w:id="3"/>',
    )
    for (const id of [1, 2, 3]) {
      expect(story).toContain(`<w:commentReference w:id="${id}"/>`)
    }
  })

  it('places all markers inside an expanded self-closing empty paragraph', async () => {
    const document = await fixtureDocument()
    const empty = document.model.stories
      .flatMap((story) => story.paragraphs)
      .find((paragraph) => paragraph.runs.length === 0)
    if (!empty) throw new Error('Fixture empty paragraph is missing.')

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_empty', empty.id, 0, 0, 'Empty paragraph review'),
    ])
    const story = requiredXml(await zipParts(output), 'word/document.xml')

    expect(story).toMatch(
      /<w:p><w:commentRangeStart w:id="1"\/><w:commentRangeEnd w:id="1"\/><w:r><w:rPr><w:rStyle w:val="CommentReference"\/><\/w:rPr><w:commentReference w:id="1"\/><\/w:r><\/w:p>/u,
    )
    expect(story).not.toContain('<w:p/><w:commentRangeStart w:id="1"/>')
  })

  it('places a comment after a text-wrapping break', async () => {
    const document = await documentWithTextWrappingBreak()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    expect(paragraph.runs.map((run) => run.text).join('')).toBe(
      'Alice\n Example overview',
    )

    const output = await serialiseDocxWithComments(document, [
      comment('cmt_break', paragraph.id, 7, 14, 'After a line break'),
    ])
    const story = requiredXml(await zipParts(output), 'word/document.xml')

    expect(story.match(/<w:br\/>/gu)).toHaveLength(1)
    expect(story).toContain('<w:commentRangeStart w:id="1"/>')
    expect(story).toContain('<w:commentRangeEnd w:id="1"/>')
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

    // The resolved thread records its done flag in commentsExtended: the new
    // part, its relationship, and its content-type override are the only
    // additional parts the export is allowed to touch.
    const extended = requiredXml(outputParts, 'word/commentsExtended.xml')
    const doneEntry = extended.match(
      /<w15:commentEx w15:paraId="([0-9A-F]{8})" w15:done="1"\/>/u,
    )
    expect(doneEntry?.[1]).toBeTruthy()
    expect(comments).toContain(`<w:p w14:paraId="${doneEntry?.[1]}"`)
    expect(extended.match(/<w15:commentEx/gu)).toHaveLength(1)
    expect(requiredXml(outputParts, '[Content_Types].xml')).toContain(
      'PartName="/word/commentsExtended.xml"',
    )
    expect(requiredXml(outputParts, 'word/_rels/document.xml.rels')).toContain(
      'relationships/commentsExtended',
    )

    for (const [name, bytes] of inputParts) {
      if (
        name === 'word/document.xml' ||
        name === 'word/comments.xml' ||
        name === '[Content_Types].xml' ||
        name === 'word/_rels/document.xml.rels'
      ) {
        continue
      }
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
    const expectedTouched = expectedTouchedCommentParts(sourceParts)

    expect(
      compareOoxmlProductCommentExport(
        comparablePackage(document, sourceParts),
        comparablePackage(document, outputParts),
        expectedTouched,
      ),
    ).toEqual({ equivalent: true })
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

  it('threads a product reply under its comment in commentsExtended', async () => {
    const document = await fixtureDocument()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const head = comment('cmt_head', paragraph.id, 0, 5, 'Head note')
    head.replies = [
      {
        imported: false,
        id: 'rpl_1',
        body: 'Reply body',
        author: { id: 'usr_2', name: 'Priya Second' },
        createdAt: '2026-08-11T12:00:00.000Z',
      },
    ]

    const bytes = await serialiseDocxWithComments(document, [head])
    const parts = await zipParts(bytes)
    const commentsXml = requiredXml(parts, 'word/comments.xml')
    const extended = requiredXml(parts, 'word/commentsExtended.xml')

    expect(commentsXml).toContain('Head note')
    expect(commentsXml).toContain('Reply body')
    // The head and reply both carry paraIds and the reply's commentEx names
    // the head's paraId as its parent.
    const headParaId =
      /<w:comment w:id="1"[^>]*><w:p w14:paraId="([0-9A-F]+)"/u.exec(
        commentsXml,
      )?.[1]
    expect(headParaId).toBeDefined()
    expect(extended).toContain(`w15:paraIdParent="${headParaId as string}"`)
  })

  it('round-trips an exported comment thread through a reparse', async () => {
    const document = await fixtureDocument()
    const paragraph = document.model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const head = comment('cmt_head', paragraph.id, 0, 5, 'Head note')
    head.replies = [
      {
        imported: false,
        id: 'rpl_1',
        body: 'Reply body',
        author: { id: 'usr_2', name: 'Priya Second' },
        createdAt: '2026-08-11T12:00:00.000Z',
      },
    ]

    const reparsed = await parseDocx(
      await serialiseDocxWithComments(document, [head]),
    )

    const exported = reparsed.model.comments.find(
      (entry) => entry.body === 'Head note',
    )
    const reply = reparsed.model.comments.find(
      (entry) => entry.body === 'Reply body',
    )
    expect(exported?.author).toBe('Sol Reviewer')
    expect(exported?.anchor?.paragraphId).toBe(paragraph.id)
    expect(exported?.anchor?.startOffset).toBe(0)
    expect(exported?.anchor?.endOffset).toBe(5)
    expect(reply?.author).toBe('Priya Second')
    expect(reply?.parentId).toBe(exported?.id)
  })

  it('threads a product reply under an imported comment head', async () => {
    const document = await fixtureDocument()
    const imported = document.model.comments.find(
      (entry) => entry.id === 'ooxml-0',
    )
    if (!imported) throw new Error('Fixture comment is missing.')

    const bytes = await serialiseDocxWithComments(
      document,
      [],
      [
        {
          ooxmlId: imported.ooxmlId,
          paraId: imported.paraId,
          reply: {
            imported: false,
            id: 'rpl_9',
            body: 'Product reply on a foreign thread',
            author: { id: 'usr_1', name: 'Sol Reviewer' },
            createdAt: '2026-08-12T12:00:00.000Z',
          },
        },
      ],
    )
    const parts = await zipParts(bytes)
    const commentsXml = requiredXml(parts, 'word/comments.xml')

    // The foreign comment survives byte-identical in its own element and the
    // reply is appended as a new comment after it.
    expect(commentsXml).toContain('Fictional review comment')
    expect(commentsXml).toContain('Product reply on a foreign thread')
  })
})

describe('imported comment extraction', () => {
  it('exposes the package comment with its anchored range', async () => {
    const document = await fixtureDocument()

    const imported = document.model.comments.find(
      (entry) => entry.id === 'ooxml-0',
    )
    expect(imported?.author).toBe('Alice Example')
    expect(imported?.body).toBe('Fictional review comment')
    expect(imported?.resolved).toBe(false)
    expect(imported?.parentId).toBeNull()
    expect(imported?.anchor).not.toBeNull()

    const paragraph = document.model.stories
      .flatMap((story) => story.paragraphs)
      .find((entry) => entry.id === imported?.anchor?.paragraphId)
    const text = paragraph?.runs.map((run) => run.text).join('') ?? ''
    expect(
      text.slice(imported?.anchor?.startOffset, imported?.anchor?.endOffset),
    ).toBe('Commented text')
  })

  it('keeps a comment whose body markers are missing listed but unanchored', async () => {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const part = zip.file('word/document.xml')
    if (!part) throw new Error('Fixture part is missing.')
    zip.file(
      'word/document.xml',
      (await part.async('string'))
        .replace('<w:commentRangeStart w:id="0"/>', '')
        .replace('<w:commentRangeEnd w:id="0"/>', '')
        .replace(
          '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>',
          '',
        ),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )

    const imported = document.model.comments.find(
      (entry) => entry.id === 'ooxml-0',
    )
    expect(imported?.body).toBe('Fictional review comment')
    expect(imported?.anchor).toBeNull()
  })
})
