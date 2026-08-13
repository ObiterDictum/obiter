import { describe, expect, it } from 'vitest'

import { createSequentialModelIdAllocator } from '../model'
import { parseStory } from './stories'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml'

function identity() {
  return {
    allocator: createSequentialModelIdAllocator(),
    usedIds: new Set<string>(),
    nextChangeId: () => 'change-000001',
  }
}

describe('parseStory nested drawings', () => {
  it('keeps textbox paragraphs out of the parent run and drops Fallback copies', () => {
    const xml = `<w:ftr xmlns:w="${WORD_NS}" xmlns:mc="${MC_NS}" xmlns:w14="${WORD_2010_NS}"><w:p w14:paraId="AAAA0001"><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p w14:paraId="BBBB0002"><w:r><w:t>Inside</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:p w14:paraId="BBBB0002"><w:r><w:t>Inside</w:t></w:r></w:p></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>Outer</w:t></w:r></w:p></w:ftr>`
    const parsed = parseStory('word/footer1.xml', 'footer', xml, identity())
    expect(
      parsed.story.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['Outer', 'Inside'])
  })
})
