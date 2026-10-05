import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset, preserveTextOpeningTag } from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { writePropertyChildren } from './model-properties'
import { insertPropertyChild, stripPropertyChild } from './property-xml'
import {
  elementFragment,
  parseXmlElements,
  setOverlayReplacement,
  type OverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import {
  patchSectionPropertiesXml,
  type SectionPropertiesPatch,
} from './section-xml'
import { wordRunInnerTextXml } from './text-run-edit'

const BODY_SECTION_KEY = 'document:sectPr'
const PAGE_BREAK_RUN = '<w:r><w:br w:type="page"/></w:r>'

/**
 * `set_section_properties` patches the body-level `w:sectPr` — the final
 * section. A paragraph-level `w:sectPr` written by `insert_section_break`
 * governs an earlier section and is preserved untouched; E5 does not address
 * an individual earlier section.
 */
export function setSectionProperties(
  document: OoxmlDocument,
  patch: SectionPropertiesPatch,
) {
  const story = mainStory(document)
  const part = requireEditablePart(document, story.partName)
  const { body, sectPr } = bodySection(part.overlay)
  const existing = part.overlay.replacements.get(BODY_SECTION_KEY)
  const start = sectPr ? sectPr.start : body.endTagStart
  const end = sectPr ? sectPr.end : body.endTagStart
  const current =
    existing && existing.start === start && existing.end === end
      ? existing.value
      : sectPr
        ? elementFragment(part.overlay.source, sectPr)
        : '<w:sectPr/>'
  const next = patchSectionPropertiesXml(current, patch)
  setOverlayReplacement(part.overlay, BODY_SECTION_KEY, {
    start,
    end,
    value: next,
  })
  mirrorStorySection(story, next)
  part.dirty = true
}

/**
 * Inserts a paragraph-level `w:sectPr` on the paragraph a section ends at,
 * seeded from the body-level section so the new section inherits its layout.
 * The body-level `w:sectPr` continues to govern the final section.
 */
export function insertSectionBreak(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
) {
  const part = requireEditablePart(document, paragraph.partName)
  // The seed is the final section's current definition, including any pending
  // section draft applied earlier in the same batch.
  const { sectPr } = bodySection(part.overlay)
  const existing = part.overlay.replacements.get(BODY_SECTION_KEY)
  const seed =
    existing?.value ??
    (sectPr ? elementFragment(part.overlay.source, sectPr) : '<w:sectPr/>')
  writePropertyChildren(part.overlay, {
    id: paragraph.wire.id,
    nodeRange: paragraph.paragraphRange,
    propertiesRange: paragraph.paragraphPropertiesRange,
    propertiesName: 'pPr',
    children: [{ localName: 'sectPr', instruction: seed, apply: true }],
  })
  mirrorParagraphSection(paragraph.wire, seed)
  part.dirty = true
}

/**
 * Inserts `<w:br w:type="page"/>` in a run at the paragraph character offset,
 * splitting the run when the offset falls inside it. The offset addresses the
 * paragraph's effective text: text replacements planned earlier in the batch
 * are read back and, when the containing run was rewritten, the run is
 * materialised with the break inline rather than overlapping the replacement.
 */
export function insertPageBreak(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  offset: number,
) {
  const part = requireEditablePart(document, paragraph.partName)
  const overlay = part.overlay
  const target = locateEffectiveRun(overlay, paragraph, offset)
  const key = `${paragraph.wire.id}:page-break:${offset}`
  if (!target.run) {
    const point = locateOffset(overlay.source, paragraph, offset)
    setOverlayReplacement(
      overlay,
      key,
      pageBreakReplacement(overlay.source, point),
    )
  } else {
    const { run, localOffset } = target
    if (pendingTextKeys(overlay, run.wire.id).length > 0) {
      materialiseRunWithBreak(overlay, run, localOffset, key)
    } else {
      const original = locateOffset(
        overlay.source,
        paragraph,
        target.originalRunStart + localOffset,
      )
      setOverlayReplacement(
        overlay,
        key,
        pageBreakReplacement(overlay.source, original),
      )
    }
  }
  paragraph.wire.preservedXmlFragments.push(PAGE_BREAK_RUN)
  part.dirty = true
}

type EffectiveRunTarget = {
  run?: ParagraphAnchor['runs'][number]
  localOffset: number
  originalRunStart: number
}

/**
 * Finds the run the effective-text offset sits strictly inside, with its
 * original source offset. A boundary offset is handled by `locateOffset` at
 * the caller.
 */
function locateEffectiveRun(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  offset: number,
): EffectiveRunTarget {
  let originalStart = 0
  let effectiveStart = 0
  for (const run of paragraph.runs) {
    const text = effectiveRunText(overlay, run)
    if (offset > effectiveStart && offset < effectiveStart + text.length) {
      return {
        run,
        localOffset: offset - effectiveStart,
        originalRunStart: originalStart,
      }
    }
    originalStart += run.wire.text.length
    effectiveStart += text.length
  }
  return { localOffset: 0, originalRunStart: 0 }
}

function effectiveRunText(
  overlay: XmlOverlay,
  run: ParagraphAnchor['runs'][number],
) {
  const keys = pendingTextKeys(overlay, run.wire.id)
  if (keys.length === 0) return run.wire.text
  return keys.map((key) => overlay.replacements.get(key)?.value ?? '').join('')
}

/** The `:text:` replacements one run's text writer left, in element order. */
function pendingTextKeys(overlay: XmlOverlay, runId: string): string[] {
  const pattern = new RegExp(`^${escapeRegExp(runId)}:text:(\\d+)$`, 'u')
  return [...overlay.replacements.keys()]
    .filter((key) => pattern.test(key))
    .sort((left, right) => textIndex(left) - textIndex(right))
}

function textIndex(key: string): number {
  return Number(key.slice(key.lastIndexOf(':') + 1))
}

/** Rewrites a run whose text a pending replacement already owns, with the
 * break inline, so the two edits do not overlap at serialise time. */
function materialiseRunWithBreak(
  overlay: XmlOverlay,
  run: ParagraphAnchor['runs'][number],
  localOffset: number,
  key: string,
) {
  const text = effectiveRunText(overlay, run)
  for (const pending of pendingTextKeys(overlay, run.wire.id)) {
    overlay.replacements.delete(pending)
  }
  const source = overlay.source
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const properties = run.runProperties.join('')
  const prefix = /^<([^:>\s]+):/u.exec(openRun)?.[1] ?? 'w'
  const left = text.slice(0, localOffset)
  const right = text.slice(localOffset)
  setOverlayReplacement(overlay, key, {
    start: run.runRange.start,
    end: run.runRange.end,
    value: `${openRun}${properties}${wordRunInnerTextXml(prefix, left)}<w:br w:type="page"/>${wordRunInnerTextXml(prefix, right)}${closeRun}`,
  })
}

/**
 * The break replacement for a located point. Mid-text splits the same way the
 * comment-anchor writer does: the replacement ends at the split offset so the
 * original closing tag of the first half is replayed by the untouched tail.
 */
function pageBreakReplacement(
  source: string,
  point: ReturnType<typeof locateOffset>,
): OverlayReplacement {
  if (!point.split) {
    return {
      start: point.sourceOffset,
      end: point.sourceOffset,
      value: PAGE_BREAK_RUN,
    }
  }
  if (point.split.kind === 'empty-paragraph') {
    const { paragraph } = point.split
    const opening = source
      .slice(paragraph.start, paragraph.startTagEnd)
      .replace(/\/\s*>$/u, '>')
    return {
      start: paragraph.start,
      end: paragraph.end,
      value: `${opening}${PAGE_BREAK_RUN}</w:p>`,
    }
  }
  const { run, textElement, position } = point.split
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const properties = run.runProperties.join('')
  if (position === 'content' && textElement) {
    const openText = source.slice(textElement.start, textElement.startTagEnd)
    const closeText = source.slice(textElement.endTagStart, textElement.end)
    const firstHalf = `${openText}${source.slice(
      textElement.startTagEnd,
      point.sourceOffset,
    )}`
    return {
      start: textElement.start,
      end: point.sourceOffset,
      value: `${firstHalf}${closeText}${closeRun}${PAGE_BREAK_RUN}${openRun}${properties}${preserveTextOpeningTag(openText)}`,
    }
  }
  return {
    start: point.sourceOffset,
    end: point.sourceOffset,
    value: `${closeRun}${PAGE_BREAK_RUN}${openRun}${properties}`,
  }
}

function bodySection(overlay: XmlOverlay) {
  const elements = parseXmlElements(overlay.source)
  const body = elements.find((element) => isWord(element, 'body'))
  if (!body) throw new OoxmlError('invalid-document-edit')
  const sectPr = elements.find(
    (element) => element.parent === body && isWord(element, 'sectPr'),
  )
  return { body, sectPr }
}

function mainStory(document: OoxmlDocument): DocumentStoryWire {
  const story = document.model.stories.find((item) => item.kind === 'document')
  if (!story) throw new OoxmlError('model-node-not-editable')
  return story
}

function mirrorStorySection(story: DocumentStoryWire, next: string) {
  const index = story.preservedXmlFragments.findIndex((fragment) =>
    /<w:sectPr\b/u.test(fragment),
  )
  if (index === -1) story.preservedXmlFragments.push(next)
  else story.preservedXmlFragments[index] = next
}

function mirrorParagraphSection(
  wire: ParagraphAnchor['wire'],
  instruction: string,
) {
  const index = wire.preservedXmlFragments.findIndex((fragment) =>
    /<w:pPr\b/u.test(fragment),
  )
  const base = index === -1 ? '<w:pPr/>' : wire.preservedXmlFragments[index]!
  const next = insertPropertyChild(
    stripPropertyChild(base, 'sectPr'),
    'sectPr',
    instruction,
  )
  if (index === -1) wire.preservedXmlFragments.push(next)
  else wire.preservedXmlFragments[index] = next
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
