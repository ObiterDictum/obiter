import {
  flowIds,
  insertParagraphWire,
  type LocalInsert,
} from './document-story-flow'
import type { StoryBlock } from './document-page-tables'

export function storyBlocksWithInserts(
  blocks: StoryBlock[],
  inserts: LocalInsert[],
): StoryBlock[] {
  if (inserts.length === 0) return blocks
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const hostIds: string[] = []
  const hostBlock = new Map<string, StoryBlock>()
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      hostIds.push(block.paragraph.id)
      hostBlock.set(block.paragraph.id, block)
    } else {
      for (const id of block.table.paragraphIds) {
        hostIds.push(id)
        hostBlock.set(id, block)
      }
    }
  }
  const seen = new Set<StoryBlock>()
  const result: StoryBlock[] = []
  for (const id of flowIds(hostIds, inserts)) {
    const insert = insertById.get(id)
    if (insert) {
      result.push({
        type: 'paragraph',
        paragraph: insertParagraphWire(insert),
      })
      continue
    }
    const block = hostBlock.get(id)
    if (!block || seen.has(block)) continue
    seen.add(block)
    result.push(block)
  }
  return result
}
