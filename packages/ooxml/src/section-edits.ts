import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset, preserveTextOpeningTag } from './text-offsets'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { splitsSurrogate } from './model-run-range-edits'
import { isBlankParagraph } from './table-of-contents-splice'
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
  activeSectionXml,
  patchSectionPropertiesXml,
  type SectionPropertiesPatch,
} from './section-xml'
import { wordRunInnerTextXml } from './text-run-edit'

const BODY_SECTION_KEY = 'document:sectPr'
const PAGE_BREAK_RUN = '<w:r><w:br w:type="page"/></w:r>'

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

export function insertSectionBreak(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (
    paragraph.wire.preservedXmlFragments.some(
      (fragment) => activeSectionXml(fragment).length > 0,
    )
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
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

export function insertPageBreak(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  offset: number,
  breakOffsets: Map<string, number[]> = new Map(),
) {
  const part = requireEditablePart(document, paragraph.partName)
  const overlay = part.overlay
  validateBreakOffset(paragraph, offset)
  if (isBlankParagraph(paragraph)) {
    insertRunIntoEmptyParagraph(overlay, paragraph, PAGE_BREAK_RUN)
    part.dirty = true
    return
  }
  const target = locateEffectiveRun(paragraph, offset)
  if (!target) {
    const point = locateOffset(overlay.source, paragraph, offset)
    setOverlayReplacement(
      overlay,
      `${paragraph.wire.id}:page-break:${offset}`,
      pageBreakInsertion(overlay.source, point),
    )
  } else if (shouldMaterialiseRun(overlay, target.run.wire.id)) {
    const localOffset = offset - target.start
    const offsets = [
      ...(breakOffsets.get(target.run.wire.id) ?? []),
      localOffset,
    ]
    breakOffsets.set(target.run.wire.id, offsets)
    materialiseRunWithBreaks(
      overlay,
      target.run,
      offsets,
      `${target.run.wire.id}:page-break-run`,
    )
  } else {
    const point = locateOffset(overlay.source, paragraph, offset)
    setOverlayReplacement(
      overlay,
      `${paragraph.wire.id}:page-break:${offset}`,
      pageBreakInsertion(overlay.source, point),
    )
  }
  part.dirty = true
}

type EffectiveRunTarget = {
  run: ParagraphAnchor['runs'][number]
  start: number
}

function locateEffectiveRun(
  paragraph: ParagraphAnchor,
  offset: number,
): EffectiveRunTarget | undefined {
  let start = 0
  for (const run of paragraph.runs) {
    if (offset > start && offset < start + run.wire.text.length) {
      return { run, start }
    }
    start += run.wire.text.length
  }
  return undefined
}

function shouldMaterialiseRun(overlay: XmlOverlay, runId: string) {
  return [...overlay.replacements.keys()].some((key) =>
    key.startsWith(`${runId}:`),
  )
}

function materialiseRunWithBreaks(
  overlay: XmlOverlay,
  run: ParagraphAnchor['runs'][number],
  offsets: readonly number[],
  key: string,
) {
  const text = run.wire.text
  const ordered = [...new Set(offsets)].sort((left, right) => left - right)
  const source = overlay.source
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const preserved = run.wire.preservedXmlFragments
  const properties = [
    ...preserved.filter((fragment) => /<w:rPr\b/u.test(fragment)),
    ...preserved.filter((fragment) => !/<w:rPr\b/u.test(fragment)),
  ].join('')
  const prefix = /^<([^:>\s]+):/u.exec(openRun)?.[1] ?? 'w'
  let cursor = 0
  let inner = ''
  for (const at of ordered) {
    inner += wordRunInnerTextXml(prefix, text.slice(cursor, at))
    inner += PAGE_BREAK
    cursor = at
  }
  inner += wordRunInnerTextXml(prefix, text.slice(cursor))
  for (const [pendingKey, replacement] of overlay.replacements) {
    const insideRun =
      replacement.start >= run.runRange.start &&
      replacement.end <= run.runRange.end &&
      replacement.start < run.runRange.end
    if (!insideRun) continue
    if (
      replacement.start === run.runRange.start &&
      replacement.end === run.runRange.start
    ) {
      continue
    }
    if (!pendingKey.startsWith(`${run.wire.id}:`)) {
      throw new OoxmlError('invalid-document-edit')
    }
    overlay.replacements.delete(pendingKey)
  }
  setOverlayReplacement(overlay, key, {
    start: run.runRange.start,
    end: run.runRange.end,
    value: `${openRun}${properties}${inner}${closeRun}`,
  })
}

function pageBreakInsertion(
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
    const closeText = source.slice(textElement.endTagStart, textElement.end)
    const openText = preserveTextOpeningTag(
      source.slice(textElement.start, textElement.startTagEnd),
    )
    return {
      start: point.sourceOffset,
      end: point.sourceOffset,
      value: `${closeText}${closeRun}${PAGE_BREAK_RUN}${openRun}${properties}${openText}`,
    }
  }
  return {
    start: point.sourceOffset,
    end: point.sourceOffset,
    value: `${closeRun}${PAGE_BREAK_RUN}${openRun}${properties}`,
  }
}

const PAGE_BREAK = '<w:br w:type="page"/>'

function insertRunIntoEmptyParagraph(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  runXml: string,
) {
  const range = paragraph.paragraphRange
  const key = `${paragraph.wire.id}:pPr`
  const existing = overlay.replacements.get(key)
  if (existing && /^<w:p\b/u.test(existing.value)) {
    setOverlayReplacement(overlay, key, {
      ...existing,
      value: existing.value.replace(/<\/w:p>$/u, `${runXml}</w:p>`),
    })
    return
  }
  const opening = overlay.source
    .slice(range.start, range.startTagEnd)
    .replace(/\/\s*>$/u, '>')
  if (existing && /^<w:pPr\b/u.test(existing.value)) {
    setOverlayReplacement(overlay, key, {
      start: range.start,
      end: range.end,
      value: `${opening}${existing.value}${runXml}</w:p>`,
    })
    return
  }
  setOverlayReplacement(overlay, key, {
    start: range.start,
    end: range.end,
    value: `${opening}${runXml}</w:p>`,
  })
}

function validateBreakOffset(paragraph: ParagraphAnchor, offset: number) {
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  if (offset > text.length || splitsSurrogate(text, offset)) {
    throw new OoxmlError('invalid-document-edit')
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
  const base = wire.preservedXmlFragments[index] ?? '<w:pPr/>'
  const next = insertPropertyChild(
    stripPropertyChild(base, 'sectPr'),
    'sectPr',
    instruction,
  )
  if (index === -1) wire.preservedXmlFragments.push(next)
  else wire.preservedXmlFragments[index] = next
}
