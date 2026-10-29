import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStyleWire,
} from '@obiter/contracts'

export type TableOfContentsEntry = {
  paragraphId: string
  level: number
  text: string
}

const TOC_OUTLINE_LEVELS = 3
const OUTLINE_LEVEL = /<w:outlineLvl\b[^>]*\bw:val="(\d+)"/u
const BUILTIN_HEADING = /^Heading([1-9])$/u

export function paragraphOutlineLevel(
  paragraph: DocumentParagraphWire,
  styles: readonly DocumentStyleWire[],
): number | undefined {
  const direct = outlineLevelOf(paragraph.preservedXmlFragments.join(''))
  if (direct !== undefined) return direct
  const byId = new Map(styles.map((style) => [style.styleId, style]))
  const seen = new Set<string>()
  let styleId: string | undefined = paragraph.styleId
  while (styleId !== undefined && !seen.has(styleId)) {
    seen.add(styleId)
    const style = byId.get(styleId)
    if (style) {
      const level = outlineLevelOf(style.sourceFragment)
      if (level !== undefined) return level
    }
    const builtin = BUILTIN_HEADING.exec(styleId)
    if (builtin) return Number.parseInt(builtin[1] ?? '1', 10) - 1
    if (!style) return undefined
    styleId = style.basedOnStyleId
  }
  return undefined
}

export function tableOfContentsEntries(
  model: DocumentModelWire,
): TableOfContentsEntry[] {
  const story = model.stories.find((item) => item.kind === 'document')
  if (!story) return []
  const entries: TableOfContentsEntry[] = []
  for (const paragraph of story.paragraphs) {
    const level = paragraphOutlineLevel(paragraph, model.styles)
    if (level === undefined || level >= TOC_OUTLINE_LEVELS) continue
    entries.push({
      paragraphId: paragraph.id,
      level: level + 1,
      text: paragraph.runs.map((run) => run.text).join(''),
    })
  }
  return entries
}

function outlineLevelOf(xml: string): number | undefined {
  const match = OUTLINE_LEVEL.exec(xml)
  if (!match) return undefined
  const level = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(level) && level >= 0 && level <= 9 ? level : undefined
}
