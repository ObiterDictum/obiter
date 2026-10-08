import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  parseModelJson,
  serialiseDocx,
  serialiseModelJson,
} from './index'

const changeContext = {
  author: 'Review & Author',
  date: '2026-08-11T12:30:00.000Z',
}

describe('typed tracked changes', () => {
  it('decodes every change element into the shared model shape', async () => {
    const document = await parseDocx(
      await fixtureWithStoryChanges([
        [
          'word/document.xml',
          '<w:ins w:id="01" custom="keep"><w:r><w:t>insert</w:t><w:unknown/></w:r></w:ins>',
        ],
        [
          'word/header1.xml',
          '<w:del w:id="bad"><w:r><w:delText>delete</w:delText></w:r></w:del>',
        ],
        [
          'word/footer1.xml',
          '<w:moveFrom w:id="7"><w:r><w:delText>from</w:delText></w:r></w:moveFrom>',
        ],
        [
          'word/footnotes.xml',
          '<w:moveTo w:id="7"><w:r><w:t>to</w:t></w:r></w:moveTo>',
        ],
        ['word/endnotes.xml', '<w:pPrChange w:id="8"><w:pPr/></w:pPrChange>'],
        ['word/comments.xml', '<w:rPrChange w:id="9"><w:rPr/></w:rPrChange>'],
      ]),
    )

    const decoded = document.model.changes.filter(
      ({ author }) => author === undefined,
    )
    expect(decoded.map(({ elementName }) => elementName)).toEqual([
      'ins',
      'del',
      'moveFrom',
      'moveTo',
      'pPrChange',
      'rPrChange',
    ])
    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyPartName: 'word/document.xml',
          ooxmlId: '01',
          kind: 'insert',
          text: 'insert',
        }),
        expect.objectContaining({
          storyPartName: 'word/footnotes.xml',
          direction: 'to',
          text: 'to',
        }),
        expect.objectContaining({ scope: 'paragraph', text: '' }),
        expect.objectContaining({ scope: 'run', text: '' }),
      ]),
    )
    const moveFrom = decoded.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    const moveTo = decoded.find(({ elementName }) => elementName === 'moveTo')
    expect(moveFrom?.storyPartName).toBe('word/footer1.xml')
    expect(moveTo?.storyPartName).toBe('word/footnotes.xml')
    expect(moveFrom?.pairId).toBe(moveTo?.id)
    expect(moveTo?.pairId).toBe(moveFrom?.id)
    expect(parseModelJson(serialiseModelJson(document))).toEqual(document.model)
    const modelJson = JSON.stringify(document.model)
    expect(modelJson).not.toContain('custom=')
    expect(modelJson).not.toContain('w:unknown')

    const ordinaryRun = mainParagraphs(document)[0]?.runs[0]
    if (!ordinaryRun) throw new Error('Ordinary fixture run is missing.')
    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: ordinaryRun.id,
        text: 'Ordinary edit',
      },
    ])
    const editedXml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(editedXml).toContain(
      '<w:ins w:id="01" custom="keep"><w:r><w:t>insert</w:t><w:unknown/></w:r></w:ins>',
    )
  })

  it('rejects invalid generated metadata before mutating an overlay', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'replace_run_text', runId: run.id, text: 'Revision' }],
        { author: 'bad\u0000author', date: changeContext.date },
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('records replacement and insertion with deterministic valid metadata', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture target is missing.')

    applyDocumentEdits(
      document,
      [
        { type: 'replace_run_text', runId: run.id, text: ' revised & text ' },
        {
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          text: ' inserted ',
        },
      ],
      changeContext,
    )
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const reparsed = await parseDocx(output)
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )

    expect(
      generated.map(({ elementName, ooxmlId }) => [elementName, ooxmlId]),
    ).toEqual([
      ['del', '16'],
      ['ins', '17'],
      ['ins', '18'],
    ])
    expect(generated.every(({ date }) => date === changeContext.date)).toBe(
      true,
    )
    expect(xml).toContain('w:author="Review &amp; Author"')
    expect(xml).toContain('<w:delText>Alice Example overview</w:delText>')
    expect(xml).toContain(
      '<w:t xml:space="preserve"> revised &amp; text </w:t>',
    )
    expect(xml).toContain('<w:t xml:space="preserve"> inserted </w:t>')
  })

  it('records paragraph deletion and property history without removing source content', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const deletion = await parseDocx(input)
    const first = mainParagraphs(deletion)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    applyDocumentEdits(
      deletion,
      [{ type: 'delete_paragraph', paragraphId: first.id }],
      changeContext,
    )
    const deletedXml = await zipText(
      await serialiseDocx(deletion),
      'word/document.xml',
    )
    expect(deletedXml).toContain(
      '<w:delText>Alice Example overview</w:delText>',
    )
    expect(deletedXml).toContain('<w:numPr>')

    const styling = await parseDocx(input)
    const paragraph = mainParagraphs(styling)[1]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture style target is missing.')
    applyDocumentEdits(
      styling,
      [
        {
          type: 'set_paragraph_style',
          paragraphId: paragraph.id,
          styleId: 'Base',
        },
        { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      ],
      changeContext,
    )
    const styled = await parseDocx(await serialiseDocx(styling))
    expect(styled.model.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementName: 'pPrChange',
          scope: 'paragraph',
        }),
        expect.objectContaining({ elementName: 'rPrChange', scope: 'run' }),
      ]),
    )
  })
})

describe('tracked change decisions', () => {
  it.each([
    ['accept', 'new', false, false],
    ['reject', 'old', false, false],
  ] as const)(
    '%s applies insert, delete, move, and property semantics atomically',
    async (action, expectedStyle, hasDeleted, hasInserted) => {
      const document = await decisionFixture()
      const ids = document.model.changes.map(({ id }) => id)
      applyTrackedChangeDecisions(document, ids, action)
      const xml = await zipText(
        await serialiseDocx(document),
        'word/document.xml',
      )

      expect(xml.includes('<w:ins')).toBe(hasInserted)
      expect(xml.includes('<w:del ')).toBe(hasDeleted)
      expect(xml).not.toContain('moveFrom')
      expect(xml).not.toContain('moveTo')
      expect(xml).not.toContain('RangeStart')
      expect(xml).not.toContain('RangeEnd')
      expect(xml).not.toContain('PrChange')
      expect(xml).toContain(`<w:pStyle w:val="${expectedStyle}"/>`)
      expect(xml).toContain(
        `<w:rStyle w:val="${expectedStyle === 'new' ? 'newChar' : 'oldChar'}"/>`,
      )
      expect(xml).not.toContain('<w:delText>')
      expect(xml).toContain(action === 'accept' ? 'Inserted' : 'Deleted')
      expect(xml).toContain(action === 'accept' ? 'Moved to' : 'Moved from')
    },
  )

  it('decides a move pair whose nodes are in different story parts', async () => {
    const document = await parseDocx(
      await fixtureWithStoryChanges([
        [
          'word/footer1.xml',
          '<w:moveFrom w:id="7"><w:r><w:delText>from</w:delText></w:r></w:moveFrom>',
        ],
        [
          'word/footnotes.xml',
          '<w:moveTo w:id="7"><w:r><w:t>to</w:t></w:r></w:moveTo>',
        ],
      ]),
    )
    const moveFrom = document.model.changes.find(
      ({ elementName, ooxmlId }) =>
        elementName === 'moveFrom' && ooxmlId === '7',
    )
    if (!moveFrom) throw new Error('Cross-part move is missing.')

    applyTrackedChangeDecisions(document, [moveFrom.id], 'accept')
    const output = await serialiseDocx(document)
    const footer = await zipText(output, 'word/footer1.xml')
    const footnotes = await zipText(output, 'word/footnotes.xml')

    expect(footer).not.toContain('moveFrom')
    expect(footer).not.toContain('>from<')
    expect(footnotes).not.toContain('moveTo')
    expect(footnotes).toContain('<w:t>to</w:t>')
  })

  it('fails closed when a property change is not inside its properties element', async () => {
    const document = await directChildPropertyFixture()
    const change = document.model.changes.find(
      ({ elementName }) => elementName === 'pPrChange',
    )
    if (!change) throw new Error('Direct-child property change is missing.')

    expect(() =>
      applyTrackedChangeDecisions(document, [change.id], 'reject'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
    expect(mainParagraphs(document)[0]?.runs[0]?.text).toBe(
      'Text that must survive',
    )
  })

  it('fails closed for malformed property history', async () => {
    const document = await parseDocx(
      await replaceDocumentXml(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pPrChange w:id="1"><w:unknown/></w:pPrChange></w:pPr><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>',
      ),
    )
    const change = document.model.changes[0]
    if (!change) throw new Error('Malformed change is missing.')

    expect(() =>
      applyTrackedChangeDecisions(document, [change.id], 'reject'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('pairs a move whose containers share w:name but not w:id', async () => {
    // Word pairs a move by the shared w:name on its moveFromRangeStart and
    // moveToRangeStart containers; the wrappers carry distinct w:ids. The
    // fixture uses that real shape, so every change it carries is decidable.
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const moveFrom = document.model.changes.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    const moveTo = document.model.changes.find(
      ({ elementName }) => elementName === 'moveTo',
    )
    if (!moveFrom || !moveTo || moveFrom.ooxmlId === moveTo.ooxmlId) {
      throw new Error('Fixture move pair is missing.')
    }
    expect(moveFrom.pairId).toBe(moveTo.id)
    expect(moveTo.pairId).toBe(moveFrom.id)

    // Deciding either half resolves both halves and their range markers in
    // the same decision.
    const applied = applyTrackedChangeDecisions(
      document,
      [moveFrom.id],
      'accept',
    )
    expect(new Set(applied)).toEqual(new Set([moveFrom.id, moveTo.id]))
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).not.toContain('moveFrom')
    expect(xml).not.toContain('moveTo')
    expect(xml).toContain('<w:t>To</w:t>')
  })

  it.each(['accept', 'reject'] as const)(
    'decides every run a named container holds in one move (%s)',
    async (action) => {
      // One move can wrap several runs on each side: the container's w:name
      // groups them all, and a single half's decision covers the whole move.
      const document = await parseDocx(
        await replaceDocumentXml(
          `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep </w:t></w:r><w:moveFromRangeStart w:id="30" w:name="move7" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>First </w:delText></w:r></w:moveFrom><w:moveFrom w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:rPr><w:b/></w:rPr><w:delText>second</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/><w:moveToRangeStart w:id="31" w:name="move7" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="6" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>First </w:t></w:r></w:moveTo><w:moveTo w:id="8" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:rPr><w:b/></w:rPr><w:t>second</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/></w:p></w:body></w:document>`,
        ),
      )
      const members = document.model.changes.filter(
        ({ kind }) => kind === 'move',
      )
      const from = members.find(
        (member) => member.kind === 'move' && member.direction === 'from',
      )
      if (members.length !== 4 || !from?.pairId) {
        throw new Error('Multi-run move did not parse.')
      }

      const applied = applyTrackedChangeDecisions(document, [from.id], action)
      expect(new Set(applied)).toEqual(new Set(members.map(({ id }) => id)))
      const xml = await zipText(
        await serialiseDocx(document),
        'word/document.xml',
      )
      expect(xml).not.toContain('moveFrom')
      expect(xml).not.toContain('moveTo')
      expect(xml).toContain('Keep')
      if (action === 'accept') {
        expect(xml).toContain('<w:t>First </w:t>')
        expect(xml).not.toContain('delText')
      } else {
        expect(xml).toContain('<w:t>First </w:t>')
        expect(xml).toContain('<w:t>second</w:t>')
      }
    },
  )

  it('decides a move whose container spans a paragraph boundary', async () => {
    // The markers can sit in different paragraphs; the runs between them are
    // still members of the same named move and decide together.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Pre </w:t></w:r><w:moveFromRangeStart w:id="30" w:name="move8" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>one</w:delText></w:r></w:moveFrom></w:p><w:p><w:moveFrom w:id="3" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>two</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/><w:r><w:t>post</w:t></w:r></w:p><w:p><w:moveToRangeStart w:id="31" w:name="move8" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="5" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>one</w:t></w:r></w:moveTo><w:moveTo w:id="7" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>two</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/></w:p></w:body></w:document>`,
      ),
    )
    const from = document.model.changes.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    if (!from?.pairId) throw new Error('Cross-paragraph move is unpaired.')

    applyTrackedChangeDecisions(document, [from.id], 'accept')
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).not.toContain('moveFrom')
    expect(xml).not.toContain('moveTo')
    expect(xml).toContain('<w:t>Pre </w:t>')
    expect(xml).toContain('<w:t>post</w:t>')
    expect(xml).toContain('<w:t>two</w:t>')
  })

  it('decides adjacent same-name containers as one move', async () => {
    // Word can split one move into several adjacent ranges under one w:name;
    // every member across every range belongs to the same decision.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep </w:t></w:r><w:moveFromRangeStart w:id="30" w:name="move14" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>one</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/><w:r><w:t> gap </w:t></w:r><w:moveFromRangeStart w:id="32" w:name="move14" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>two</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="32"/><w:moveToRangeStart w:id="33" w:name="move14" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="6" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>one</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="33"/><w:moveToRangeStart w:id="34" w:name="move14" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="8" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>two</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="34"/></w:p></w:body></w:document>`,
      ),
    )
    const members = document.model.changes.filter(({ kind }) => kind === 'move')
    if (members.length !== 4 || members.some(({ pairId }) => !pairId)) {
      throw new Error('Adjacent-range move did not parse.')
    }

    const first = members[0]
    if (!first) throw new Error('Adjacent-range move did not parse.')
    const applied = applyTrackedChangeDecisions(document, [first.id], 'accept')
    expect(new Set(applied)).toEqual(new Set(members.map(({ id }) => id)))
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).not.toContain('moveFrom')
    expect(xml).not.toContain('moveTo')
    expect(xml).not.toContain('RangeStart')
    expect(xml).not.toContain('RangeEnd')
    expect(xml).toContain('<w:t> gap </w:t>')
    expect(xml).toContain('<w:t>one</w:t>')
    expect(xml).toContain('<w:t>two</w:t>')
  })

  it('refuses nested move containers', async () => {
    // A container inside another container is not a shape Word produces; the
    // inner markers sit inside the outer range uncovered, so the outer group
    // — and any member under it — stays undecidable and byte-preserved.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:moveFromRangeStart w:id="30" w:name="outer" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>outer</w:delText></w:r></w:moveFrom><w:moveFromRangeStart w:id="32" w:name="inner" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>inner</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="32"/><w:moveFromRangeEnd w:id="30"/><w:moveToRangeStart w:id="33" w:name="outer" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="6" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>outer</w:t></w:r></w:moveTo><w:moveTo w:id="8" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>inner</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="33"/></w:p></w:body></w:document>`,
      ),
    )
    const moves = document.model.changes.filter(({ kind }) => kind === 'move')
    // The inner markers sit inside the outer range uncovered, so the outer
    // container is dirty and its members stay unpaired; the inner name has no
    // to-side container here, so nothing pairs at all.
    if (moves.length !== 4) throw new Error('Nested move members are missing.')
    expect(moves.every(({ pairId }) => pairId === undefined)).toBe(true)

    expect(() =>
      applyTrackedChangeDecisions(
        document,
        moves.map(({ id }) => id),
        'accept',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('fails closed when a named container has no destination', async () => {
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:moveFromRangeStart w:id="30" w:name="move9" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>Orphan</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/><w:r><w:t>Keeps</w:t></w:r></w:p></w:body></w:document>`,
      ),
    )
    const orphan = document.model.changes.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    if (!orphan) throw new Error('Container move is missing.')
    expect(orphan.pairId).toBeUndefined()

    expect(() =>
      applyTrackedChangeDecisions(document, [orphan.id], 'accept'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
    // The undecidable move is preserved byte-identically, markers included.
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('moveFromRangeStart')
    expect(xml).toContain('moveFromRangeEnd')
  })

  it('fails closed when a container carries content outside its wrappers', async () => {
    // A bare run inside the named range is moved content no member wrapper
    // covers — a member-wise decision would leave it stranded at the source.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:moveFromRangeStart w:id="30" w:name="move10" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>wrapped</w:delText></w:r></w:moveFrom><w:r><w:delText>loose</w:delText></w:r><w:moveFromRangeEnd w:id="30"/><w:moveToRangeStart w:id="31" w:name="move10" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>wrapped</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/></w:p></w:body></w:document>`,
      ),
    )
    const members = document.model.changes.filter(({ kind }) => kind === 'move')
    if (members.length !== 2) throw new Error('Dirty-container move missing.')
    expect(members.every(({ pairId }) => pairId === undefined)).toBe(true)

    for (const action of ['accept', 'reject'] as const) {
      expect(() =>
        applyTrackedChangeDecisions(
          document,
          members.map(({ id }) => id),
          action,
        ),
      ).toThrowError(
        expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
      )
    }
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('does not pair same-named containers living in different parts', async () => {
    // Move names are scoped to their story part: a "move1" in a footer is a
    // different move from a "move1" in the footnotes part.
    const document = await parseDocx(
      await fixtureWithStoryChanges([
        [
          'word/footer1.xml',
          '<w:moveFromRangeStart w:id="30" w:name="move1" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>from</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/>',
        ],
        [
          'word/footnotes.xml',
          '<w:moveToRangeStart w:id="31" w:name="move1" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>to</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/>',
        ],
      ]),
    )
    const moves = document.model.changes.filter(
      ({ kind, storyPartName }) =>
        kind === 'move' && storyPartName !== 'word/document.xml',
    )
    if (moves.length !== 2) throw new Error('Cross-part moves are missing.')
    expect(moves.every(({ pairId }) => pairId === undefined)).toBe(true)
  })

  it('keeps a paragraph-mark move listed but undecidable', async () => {
    // Word records a moved whole paragraph by marking the paragraph mark
    // (pPr/rPr/moveFrom) inside a range container, not by wrapping runs.
    // Deciding that needs whole-paragraph semantics E9 does not implement, so
    // the move lists and preserves but refuses rather than half-apply.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep</w:t></w:r></w:p><w:moveFromRangeStart w:id="30" w:name="move11" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:p><w:pPr><w:rPr><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"/></w:rPr></w:pPr><w:r><w:delText>Moved paragraph</w:delText></w:r></w:p><w:moveFromRangeEnd w:id="30"/><w:moveToRangeStart w:id="31" w:name="move11" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:p><w:pPr><w:rPr><w:moveTo w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"/></w:rPr></w:pPr><w:r><w:t>Moved paragraph</w:t></w:r></w:p><w:moveToRangeEnd w:id="31"/></w:body></w:document>`,
      ),
    )
    const marks = document.model.changes.filter(({ kind }) => kind === 'move')
    if (marks.length !== 2) throw new Error('Mark moves are missing.')
    expect(marks.every(({ pairId }) => pairId === undefined)).toBe(true)

    expect(() =>
      applyTrackedChangeDecisions(
        document,
        marks.map(({ id }) => id),
        'accept',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('moveFromRangeStart')
    expect(xml).toContain('<w:delText>Moved paragraph</w:delText>')
  })

  it('fails closed on a move source without its range end', async () => {
    // A RangeStart with no matching RangeEnd is no container, so the wrapper
    // inside it pairs by nothing and must stay undecidable.
    const document = await parseDocx(
      await replaceDocumentXml(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:moveFromRangeStart w:id="30" w:name="move12" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="2" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:delText>Open</w:delText></w:r></w:moveFrom><w:moveToRangeStart w:id="31" w:name="move12" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="4" w:author="A" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Open</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/></w:p></w:body></w:document>`,
      ),
    )
    const moves = document.model.changes.filter(({ kind }) => kind === 'move')
    if (moves.length !== 2) throw new Error('Open-container moves missing.')
    // The from wrapper falls back to nothing: unmatched container means no
    // named group, and distinct w:ids pair by neither mechanism.
    expect(moves.every(({ pairId }) => pairId === undefined)).toBe(true)
    expect(() =>
      applyTrackedChangeDecisions(
        document,
        moves.map(({ id }) => id),
        'accept',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
  })

  it('fails closed for an orphan move and leaves every part clean', async () => {
    // Distinct w:ids and no w:name is an unpaired move — deciding it, alone
    // or inside a bulk request, is refused rather than resolved half-way.
    const document = await parseDocx(
      await replaceDocumentXml(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:ins w:id="1"><w:r><w:t>Inserted</w:t></w:r></w:ins><w:moveFrom w:id="2"><w:r><w:delText>Orphan from</w:delText></w:r></w:moveFrom><w:r><w:t>Keeps</w:t></w:r></w:p></w:body></w:document>',
      ),
    )
    const orphan = document.model.changes.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    const valid = document.model.changes.find(
      ({ elementName }) => elementName === 'ins',
    )
    if (!orphan || !valid) throw new Error('Fixture changes are missing.')
    expect(orphan.pairId).toBeUndefined()

    for (const ids of [[orphan.id], [valid.id, orphan.id]]) {
      expect(() =>
        applyTrackedChangeDecisions(document, ids, 'accept'),
      ).toThrowError(
        expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
      )
    }
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })
})

async function directChildPropertyFixture() {
  return parseDocx(
    await replaceDocumentXml(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPrChange w:id="1"><w:pPr><w:pStyle w:val="old"/></w:pPr></w:pPrChange><w:r><w:t>Text that must survive</w:t></w:r></w:p></w:body></w:document>',
    ),
  )
}

async function decisionFixture() {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="new"/><w:pPrChange w:id="4"><w:pPr><w:pStyle w:val="old"/></w:pPr></w:pPrChange></w:pPr><w:ins w:id="1"><w:r><w:t>Inserted</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:moveFromRangeStart w:id="30" w:name="move1" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveFrom w:id="3"><w:r><w:delText>Moved from</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="30"/><w:moveToRangeStart w:id="31" w:name="move1" w:author="A" w:date="2026-08-10T10:00:00Z"/><w:moveTo w:id="6"><w:r><w:t>Moved to</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="31"/><w:r><w:rPr><w:rStyle w:val="newChar"/><w:rPrChange w:id="5"><w:rPr><w:rStyle w:val="oldChar"/></w:rPr></w:rPrChange></w:rPr><w:t>Styled</w:t></w:r></w:p></w:body></w:document>`
  return parseDocx(await replaceDocumentXml(xml))
}

async function fixtureWithStoryChanges(
  changes: readonly (readonly [string, string])[],
) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  for (const [partName, change] of changes) {
    const entry = zip.file(partName)
    if (!entry) throw new Error('Fixture story is missing.')
    const source = await entry.async('string')
    zip.file(partName, source.replace(/(<w:p(?:\s[^>]*)?>)/u, `$1${change}`))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function replaceDocumentXml(xml: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'uint8array' })
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(partName)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
