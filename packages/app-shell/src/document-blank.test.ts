import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { parseDocx } from '@obiter/ooxml'
import {
  emptyFormatDrafts,
  formatControlState,
  paragraphStyleOptions,
} from './document-format-edits'
import { blankDocumentFile } from './document-blank'

describe('blankDocumentFile', () => {
  it('builds an Untitled Word document for upload', async () => {
    const file = await blankDocumentFile()
    expect(file.name).toBe('Untitled.docx')
    expect(file.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(file.size).toBeGreaterThan(0)
  })

  it('offers bullets, numbering, multilevel numbering and paragraph styles', async () => {
    const file = await blankDocumentFile()
    const document = await parseDocx(new Uint8Array(await file.arrayBuffer()))
    const model = document.model
    const paragraph = model.stories.find((item) => item.kind === 'document')
      ?.paragraphs[0]
    if (!paragraph) throw new Error('Expected a body paragraph.')

    const state = formatControlState(model, emptyFormatDrafts, paragraph.id)
    expect(state.canApplyBullet).toBe(true)
    expect(state.canApplyNumber).toBe(true)
    expect(state.canApplyMultilevel).toBe(true)
    expect(paragraphStyleOptions(model).length).toBeGreaterThan(0)
  })
})
