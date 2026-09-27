import { describe, expect, it } from 'bun:test'

import {
  canonicaliseParagraphIdentities,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from './index'

function documentParagraphs(
  model: Awaited<ReturnType<typeof parseDocx>>['model'],
) {
  return (
    model.stories.find((story) => story.kind === 'document')?.paragraphs ?? []
  )
}

async function parsed(paragraphs: Parameters<typeof createSyntheticDocx>[0]) {
  return parseDocx(await createSyntheticDocx(paragraphs))
}

describe('paragraph identity canonicalisation', () => {
  it('preserves a valid unique id and never leaves two paragraphs sharing one', async () => {
    const document = await parsed([
      { text: 'Alpha', paraId: 'AAAA1111' },
      { text: 'Beta', paraId: 'AAAA1111' },
      { text: 'Gamma', paraId: 'zz' },
    ])
    canonicaliseParagraphIdentities(document)
    const reloaded = await parseDocx(await serialiseDocx(document))
    const ids = documentParagraphs(reloaded.model).map((item) => item.id)

    expect(ids[0]).toBe('para-w14-AAAA1111')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.includes('AAAA1111')).length).toBe(1)
    for (const paragraph of documentParagraphs(reloaded.model)) {
      expect(paragraph.sourceParaId).toMatch(/^[0-9A-F]{8}$/u)
    }
  })

  it('keeps distinct valid ids and assigns a deterministic fresh one for a malformed id', async () => {
    const document = await parsed([
      { text: 'Alpha', paraId: 'AAAA1111' },
      { text: 'Beta', paraId: 'BBBB2222' },
      { text: 'Gamma', paraId: 'not-hex' },
    ])
    canonicaliseParagraphIdentities(document)
    const reloaded = await parseDocx(await serialiseDocx(document))
    const ids = documentParagraphs(reloaded.model).map((item) => item.id)

    expect(ids[0]).toBe('para-w14-AAAA1111')
    expect(ids[1]).toBe('para-w14-BBBB2222')
    // The malformed value is replaced, not persisted.
    expect(ids[2]).toMatch(/^para-w14-[0-9A-F]{8}$/u)
    expect(ids[2]).not.toBe('para-w14-not-hex')
    expect(new Set(ids).size).toBe(3)
  })

  it('assigns no id to a paragraph that already had one and did not change', async () => {
    const document = await parsed([
      { text: 'Alpha', paraId: 'AAAA1111' },
      { text: 'Beta', paraId: 'BBBB2222' },
    ])
    const before = documentParagraphs(document.model).map((item) => ({
      id: item.id,
      sourceParaId: item.sourceParaId,
    }))
    canonicaliseParagraphIdentities(document)
    const after = documentParagraphs(document.model).map((item) => ({
      id: item.id,
      sourceParaId: item.sourceParaId,
    }))
    expect(after).toEqual(before)
  })
})
