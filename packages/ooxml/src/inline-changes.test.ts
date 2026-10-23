import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { buildOoxmlFixture } from '../fixtures/builder'
import { parseDocx, replaceTextRunText, serialiseDocx } from './index'

const deleted =
  '<w:del w:id="1" w:author="Alex Example" custom="kept"><w:r><w:delText>60,000</w:delText></w:r></w:del>'
const inserted =
  '<w:ins w:id="2" w:author="Alex Example"><w:r><w:t>50,000</w:t></w:r></w:ins>'
async function fixture() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Order </w:t></w:r>${deleted}${inserted}<w:r><w:t> units</w:t></w:r><w:moveFrom w:id="3"><w:r><w:t>old</w:t></w:r></w:moveFrom><w:moveTo w:id="3"><w:r><w:t>new</w:t></w:r></w:moveTo></w:p><w:p>${deleted}${inserted}</w:p></w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

describe('inline revision positions', () => {
  it('anchors adjacent partial revisions in source order, and wholly tracked paragraphs at end', async () => {
    const document = await parseDocx(await fixture())
    const body = document.model.stories.find(
      (story) => story.kind === 'document',
    )
    const paragraph = body?.paragraphs[0]
    expect(paragraph?.runs.map((run) => run.text)).toEqual(['Order ', ' units'])
    const tail = paragraph?.runs[1]
    if (!tail) throw new Error('Expected ordinary trailing run')
    const changes = document.model.changes.filter(
      (change) => change.storyPartName === 'word/document.xml',
    )
    expect(
      changes.map((change) => [
        change.text,
        change.inlinePosition && {
          beforeRunId: change.inlinePosition.beforeRunId,
        },
      ]),
    ).toEqual([
      ['60,000', { beforeRunId: tail.id }],
      ['50,000', { beforeRunId: tail.id }],
      ['old', { beforeRunId: null }],
      ['new', { beforeRunId: null }],
      ['60,000', { beforeRunId: null }],
      ['50,000', { beforeRunId: null }],
    ])
    expect(body?.paragraphs[1]?.runs).toEqual([])
  })

  it('keeps opaque revisions byte-identical when editing ordinary neighbouring text', async () => {
    const document = await parseDocx(await fixture())
    const run = document.model.stories.find(
      (story) => story.kind === 'document',
    )?.paragraphs[0]?.runs[0]
    if (!run) throw new Error('Expected editable neighbour')
    replaceTextRunText(document, run.id, 'Supply ')
    const saved = await JSZip.loadAsync(await serialiseDocx(document))
    const xml = await saved.file('word/document.xml')?.async('string')
    expect(xml).toContain(deleted)
    expect(xml).toContain(inserted)
    expect(xml).toContain('Supply ')
  })
})
