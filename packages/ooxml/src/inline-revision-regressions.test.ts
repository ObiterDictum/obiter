import { expect, it } from 'bun:test'
import JSZip from 'jszip'
import {
  applyDocumentEdits,
  parseDocx,
  parseModelJson,
  serialiseModelJson,
  serialiseDocx,
} from './index'
import { probePackage, rel } from './share-safe-probe-kit'

for (const name of ['ins', 'del']) {
  it(`refuses replacement of a wholly tracked ${name} paragraph before mutating bytes`, async () => {
    const revision = `<w:${name} w:id="7"><w:r><w:${name === 'del' ? 'delText' : 't'}>tracked</w:${name === 'del' ? 'delText' : 't'}></w:r></w:${name}>`
    const document = await parseDocx(
      await probePackage({ body: `<w:p>${revision}</w:p>` }),
    )
    const paragraph = document.model.stories[0]?.paragraphs.at(-1)
    if (!paragraph) throw new Error('Missing revision paragraph')
    expect(paragraph.runs).toEqual([])
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          text: 'X',
        },
        { type: 'delete_paragraph', paragraphId: paragraph.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    const zip = await JSZip.loadAsync(await serialiseDocx(document))
    expect(await zip.file('word/document.xml')?.async('string')).toContain(
      `<w:p>${revision}</w:p>`,
    )
    expect(document.model.stories[0]?.paragraphs).toHaveLength(2)
  })
}

it('projects nested revisions in source order without adding review decisions', async () => {
  const revision =
    '<w:ins w:id="7" w:author="Outer"><w:r><w:t>a</w:t></w:r><w:del w:id="8" w:author="Inner"><w:r><w:delText>b</w:delText></w:r></w:del><w:r><w:t>c</w:t></w:r></w:ins>'
  const document = await parseDocx(
    await probePackage({
      body: `<w:p>${revision}<w:r><w:t> tail</w:t></w:r></w:p>`,
    }),
  )
  expect(document.model.changes).toHaveLength(1)
  expect(document.model.changes[0]).toMatchObject({
    text: 'ac',
    inlinePosition: {
      segments: [
        { text: 'a', deleted: false, author: 'Outer' },
        { text: 'b', deleted: true, author: 'Inner' },
        { text: 'c', deleted: false, author: 'Outer' },
      ],
    },
  })
  const zip = await JSZip.loadAsync(await serialiseDocx(document))
  expect(await zip.file('word/document.xml')?.async('string')).toContain(
    revision,
  )
})

it('distinguishes tracked page and column breaks from line breaks', async () => {
  const document = await parseDocx(
    await probePackage({
      body: '<w:p><w:ins w:id="7"><w:r><w:t>a</w:t><w:br w:type="page"/><w:t>b</w:t><w:br w:type="column"/><w:t>c</w:t><w:cr/></w:r></w:ins></w:p>',
    }),
  )
  expect(document.model.changes[0]?.text).toBe('a\fb\vc\n')
})

it('resolves tracked hyperlink display targets with the ordinary scheme policy', async () => {
  for (const target of ['https://example.com', 'javascript:alert(1)']) {
    const document = await parseDocx(
      await probePackage({
        body: '<w:p><w:hyperlink r:id="link"><w:ins w:id="7"><w:r><w:t>linked</w:t></w:r></w:ins></w:hyperlink></w:p>',
        documentRels: rel(
          'link',
          'hyperlink',
          target,
          ' TargetMode="External"',
        ),
      }),
    )
    expect(
      document.model.changes[0]?.inlinePosition?.segments?.[0]?.hyperlinkTarget,
    ).toBe(target.startsWith('https:') ? target : undefined)
  }
})

it('regenerates cached models missing nested display segments', async () => {
  const document = await parseDocx(
    await probePackage({
      body: '<w:p><w:ins w:id="7"><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>',
    }),
  )
  expect(parseModelJson(serialiseModelJson(document))).toEqual(document.model)
  const position = document.model.changes[0]?.inlinePosition
  if (!position) throw new Error('Missing inline revision')
  Reflect.deleteProperty(position, 'segments')
  expect(() => parseModelJson(serialiseModelJson(document))).toThrowError(
    expect.objectContaining({ code: 'invalid-model-json' }),
  )
})
