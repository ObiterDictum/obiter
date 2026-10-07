import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStyleWire,
} from '@obiter/contracts'

/**
 * One stored `TOC` entry: the heading paragraph it names, the entry level the
 * `\o "1-3"` switch collects (1-3), and the heading text captured at write.
 */
export type TableOfContentsEntry = {
  paragraphId: string
  level: number
  text: string
}

// Outline levels are 0-based under `w:outlineLvl`; the `\o "1-3"` switch
// collects the first three.
const TOC_OUTLINE_LEVELS = 3
// A `w:style` element's `w:pPr` child carrying the style's outline level.
const OUTLINE_LEVEL = /<w:outlineLvl\b[^>]*\bw:val="(\d+)"/u
// The built-in paragraph style identifiers ECMA-376 reserves for headings.
// A style carrying one without an explicit `w:outlineLvl` still sits at that
// outline level — the identifier, not an English display name, is what is
// matched.
const BUILTIN_HEADING = /^Heading([1-9])$/u

/**
 * The outline level a paragraph paints at — 0-based like `w:outlineLvl` —
 * or undefined when it is body text. A direct `w:outlineLvl` on the
 * paragraph wins; otherwise the value is resolved down the style's
 * `w:basedOn` chain, and a style with no explicit level still claims its
 * built-in heading identifier's level. This is the heading rule a `TOC \o`
 * field applies: collected by style, never by matching display strings.
 */
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
    // A referenced style with no explicit level still claims its built-in
    // identifier's level — `w:latentStyles` gives `Heading1` its outline
    // level whether `styles.xml` carries the definition or not.
    const builtin = BUILTIN_HEADING.exec(styleId)
    if (builtin) return Number.parseInt(builtin[1] ?? '1', 10) - 1
    if (!style) return undefined
    styleId = style.basedOnStyleId
  }
  return undefined
}

/**
 * The entries a `TOC \o "1-3" \u` field stores when written now: every
 * document-story paragraph at outline levels 1-3, in story order, with the
 * text the paragraph's runs currently join to. The snapshot is computed at
 * write time; nothing recomputes it later, so a pending draft keeps only a
 * placement marker and this list exists only inside the save.
 */
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
