import { expect, it } from 'bun:test'

import { applyDocumentEdits } from './index'
import {
  documentXml,
  load,
  paragraphs,
  save,
} from './model-run-emphasis.test-support'

it('reads a Word carriage return as a line break and replaces it on save', async () => {
  const document = await load(
    '<w:p><w:r><w:t>First line</w:t><w:cr/><w:t>Second line</w:t></w:r></w:p>',
  )
  const run = paragraphs(document)[0]?.runs[0]
  if (!run) throw new Error('Missing fixture run')
  expect(run.text).toBe('First line\nSecond line')
  applyDocumentEdits(document, [
    { type: 'replace_run_text', runId: run.id, text: 'Replacement\nTail' },
  ])
  const xml = await documentXml(document)
  expect(xml).not.toContain('<w:cr')
  expect(xml.match(/<w:br\/>/gu)).toHaveLength(1)
  expect(paragraphs(await save(document))[0]?.runs[0]?.text).toBe(
    'Replacement\nTail',
  )
})

it('formats text after a carriage return using its visible offset', async () => {
  const document = await load(
    '<w:p><w:r><w:t>Before</w:t><w:cr/><w:t>After</w:t></w:r></w:p>',
  )
  const paragraph = paragraphs(document)[0]
  if (!paragraph) throw new Error('Missing fixture paragraph')
  applyDocumentEdits(document, [
    {
      type: 'set_run_emphasis',
      paragraphId: paragraph.id,
      from: 7,
      to: 12,
      bold: true,
    },
  ])
  const runs = paragraphs(await save(document))[0]?.runs ?? []
  expect(runs.map((run) => run.text).join('')).toBe('Before\nAfter')
  expect(
    runs
      .filter((run) =>
        run.preservedXmlFragments.some((fragment) => fragment.includes('<w:b')),
      )
      .map((run) => run.text)
      .join(''),
  ).toBe('After')
})
