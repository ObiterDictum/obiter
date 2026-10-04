import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  applyRunTextReplacementRange,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { StaticDocumentPages, layoutDocumentPages } from './document-render'

afterEach(cleanup)

async function blackBarModel() {
  const parsed = await parseDocx(await createSyntheticDocx(['[REDACTED]']))
  const story = parsed.model.stories.find((item) => item.kind === 'document')
  const paragraph = story?.paragraphs[0]
  const anchor = paragraph && parsed.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('synthetic document has no paragraph anchor')
  applyRunTextReplacementRange(parsed, anchor, [
    {
      from: 0,
      to: '[REDACTED]'.length,
      text: '[REDACTED]',
      emphasis: { highlight: 'black', colour: '000000' },
    },
  ])
  // The edit lives in the document overlay until it is serialised, so re-read
  // the bytes exactly as a renderer caller would.
  return (await parseDocx(await serialiseDocx(parsed))).model
}

describe('StaticDocumentPages', () => {
  it('paints one sheet per laid-out page', async () => {
    const parsed = await parseDocx(await createSyntheticDocx(['Hello page']))
    const pages = layoutDocumentPages(parsed.model)
    const { container } = render(
      <StaticDocumentPages model={parsed.model} pages={pages} />,
    )
    expect(container.querySelectorAll('[data-document-sheet]')).toHaveLength(
      pages.length,
    )
  })

  it('paints black-bar emphasis as opaque black', async () => {
    const model = await blackBarModel()
    render(
      <StaticDocumentPages model={model} pages={layoutDocumentPages(model)} />,
    )
    const run = screen.getByText('[REDACTED]')
    expect(run.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(run.style.color).toBe('rgb(0, 0, 0)')
  })
})
