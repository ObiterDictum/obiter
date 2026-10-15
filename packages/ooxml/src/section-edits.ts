import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset, preserveTextOpeningTag } from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { splitsSurrogate } from './model-run-range-edits'
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
  // A paragraph that already carries a `w:sectPr` is the end paragraph of an
  // existing section, holding its geometry and header/footer references. There
  // is no second section that can end at the same paragraph, and rewriting it
  // from the body seed would silently discard the existing section's
  // definition, so refuse the ambiguous edit. `activeSectionXml` ignores a
  // section recorded only in the paragraph's `w:pPrChange` history.
  if (
    paragraph.wire.preservedXmlFragments.some(
      (fragment) => activeSectionXml(fragment).length > 0,
    )
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
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
 * paragraph's effective text: a text replacement earlier in the batch has
 * already updated `wire.text`, and a run it rewrote is materialised with every
 * accumulated break inline rather than overlapping the replacement.
 */
export function insertPageBreak(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  offset: number,
  breakOffsets: Map<string, number[]> = new Map(),
) {
  const part = requireEditablePart(document, paragraph.partName)
  const overlay = part.overlay
  validateBreakOffset(paragraph, offset)
  // A truly empty paragraph has no run to splice: the break run and any section
  // properties share one paragraph-owned replacement so they compose in schema
  // order instead of two full-node (or same-offset) replacements colliding.
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
    // The requested offset addresses the paragraph's effective text, but a
    // materialised run is rebuilt from its own text, so convert to run-local
    // before accumulating it.
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

/**
 * Finds the run the effective-text offset sits strictly inside, with the
 * paragraph-level offset the run starts at. A boundary offset is handled by
 * `locateOffset` at the caller.
 */
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

/**
 * Whether the run already owns a pending overlay write. Any run-keyed key — a
 * text replacement, a run-property write, or an earlier materialised break —
 * means the run's text and structure live in the overlay, so a new break must
 * rebuild the run from its effective properties rather than reopen its tail
 * from the parse-time `runProperties` snapshot.
 */
function shouldMaterialiseRun(overlay: XmlOverlay, runId: string) {
  return [...overlay.replacements.keys()].some((key) =>
    key.startsWith(`${runId}:`),
  )
}

/**
 * Rewrites a run whose overlay already owns its text or properties, with every
 * pending page break inline. It folds the run's non-text children (including a
 * run-property write already patched onto `wire.preservedXmlFragments`) and its
 * effective text, then clears every in-run replacement before claiming the
 * whole run range, so the breaks compose with the text and property writes
 * instead of overlapping them. `offsets` are run-local, not paragraph offsets.
 *
 * Limitation: the preserved non-text children are emitted before the text, so
 * a run that interleaves a structural child (a tab, a drawing, a field) with
 * text and is materially rebuilt here loses that interleaving. The
 * source-slicing path preserves it and is used whenever the run has no pending
 * overlay; a run whose text a `replace_run_text` rewrote no longer has a
 * source-to-model mapping for its children, so the reorder is confined to that
 * already-rewritten case. The run-properties fragment(s) are always emitted
 * first, ahead of the remaining preserved children, because `CT_Run` requires
 * `w:rPr` before any structural child: a property write that appended an
 * `w:rPr` after an existing break or tab would otherwise rebuild a run whose
 * first child is not its properties.
 */
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
    // A zero-width replacement exactly at the run's start belongs to the
    // preceding boundary, exactly as `hasPendingBreakSplice` already treats it
    // for the run-keyed writers. The paragraph-keyed page-break splice emits
    // its standalone break run before the run tag, so it neither closes nor
    // reopens this run; the rebuild leaves it in place and the overlay orders
    // the zero-width splice before the rebuilt run. Without this skip the
    // splice satisfies `insideRun` and a batch that is otherwise serialisable —
    // a break at the run start, a run-keyed write there, then a break strictly
    // inside the same run — is over-refused.
    if (
      replacement.start === run.runRange.start &&
      replacement.end === run.runRange.start
    ) {
      continue
    }
    // A non-run-keyed replacement strictly inside the run is a splice this
    // rebuild would silently drop, losing the break it carries. Fail closed as
    // a typed edit error rather than let serialisation hit the overlay's plain
    // overlap error. (A non-zero-width replacement from the run's start is the
    // whole-run rebuild and is folded like any other run-keyed write.)
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

/**
 * The zero-width break insertion for a located point. Every point in one text
 * element is spliced independently (the enclosing run and text are closed and
 * reopened around the break), so two breaks in the same run never overlap at
 * serialise time.
 */
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
  // A truly empty paragraph is intercepted by `insertPageBreak`; this branch
  // keeps the located-point contract total if a future caller reaches it.
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

/**
 * A paragraph with no runs and no paragraph properties: the only shape where a
 * page break and a section break both claim the same node.
 */
function isBlankParagraph(paragraph: ParagraphAnchor) {
  return (
    paragraph.runs.length === 0 &&
    paragraph.paragraphPropertiesRange === undefined
  )
}

/**
 * Appends a run into a blank paragraph, reusing the paragraph-owned `<w:pPr>`
 * replacement a property writer (style, section break) may already have
 * created. One replacement per paragraph is what lets a page break and a
 * section break compose in schema order — `w:pPr` first, then the break run —
 * instead of two full-node replacements colliding or two same-offset inserts
 * racing for order.
 */
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

/**
 * Validates the offset against the paragraph's effective text. The plan pass
 * cannot do this: a same-batch `replace_run_text` changes the text length, and
 * `wire.text` only holds the effective text once that operation has run.
 */
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
