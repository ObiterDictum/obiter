import type { DocumentTextRunWire } from '@obiter/contracts'
import { definedTermBookmarkName } from '@obiter/contracts'

import { nextBookmarkId } from './document-bookmarks'
import { recordSplitRun, type LineageRecorder } from './document-lineage'
import { coveringRuns, type CoveringRun } from './hyperlink-edits'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { allocateModelId } from './model-paragraph-edits'
import { runPieceXml, splitsSurrogate } from './model-run-range-edits'
import { locateOffset } from './text-offsets'
import {
  escapeXmlAttribute,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import {
  effectiveRunView,
  runHasPendingOverlay,
  type EffectiveRunView,
} from './run-effective'
import { requireEditablePart } from './model-edit-overlay'

/**
 * Marks `[from, to)` of `paragraph`'s effective text as a defined term: a
 * `w:bookmarkStart`/`w:bookmarkEnd` pair spliced around the covered words,
 * named `_Def_<normalised term>` so the check can read the term back out of
 * the stored fragments — the wire keeps no offset for a paragraph-level
 * fragment. The same term marked twice writes a second pair under the same
 * name: duplicate marks are legal OOXML, and the check reports them rather
 * than the writer silently deduplicating a drafting fact.
 *
 * The name is derived from the covered text at write time, so the client
 * never invents bookmark names. A range that cannot name a term — no word
 * characters, or longer than the bookmark-name cap — is refused, matching
 * the draft-side refusal.
 *
 * The write reuses the link writer's run-splitting: only the first and last
 * covered runs are cut, each boundary run is rewritten whole, and the wire
 * gains the run pieces a reparse would produce so a later same-batch edit
 * still addresses the right text. The mark inserts no text, so no offset
 * downstream can move.
 */
export function markDefinedTerm(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  from: number,
  to: number,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  if (
    from < 0 ||
    to > text.length ||
    from >= to ||
    splitsSurrogate(text, from) ||
    splitsSurrogate(text, to)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  const name = definedTermBookmarkName(text.slice(from, to))
  if (name === null) throw new OoxmlError('invalid-document-edit')
  const runs = coveringRuns(paragraph, from, to)
  refuseMarkInsideHyperlink(part.overlay.source, runs)
  const id = nextBookmarkId(part.overlay)
  const bookmarkStart = `<w:bookmarkStart w:id="${String(id)}" w:name="${escapeXmlAttribute(name)}"/>`
  const bookmarkEnd = `<w:bookmarkEnd w:id="${String(id)}"/>`
  writeMarkPair(
    document,
    part.overlay,
    paragraph,
    runs,
    bookmarkStart,
    bookmarkEnd,
    occurrence,
    lineage,
  )
  paragraph.wire.preservedXmlFragments.push(bookmarkStart, bookmarkEnd)
  part.dirty = true
}

/**
 * A mark boundary that lands inside a stored `w:hyperlink` element would cut
 * the link's anchor text — the stored twin of the draft layer's
 * inside-a-linked-run refusal. The wire does not flag every stored link (an
 * internal anchor or a dropped target leaves no `hyperlinkTarget`), so the
 * check reads the source elements directly. A link wholly inside the marked
 * range composes: the pair is legal OOXML around it.
 */
function refuseMarkInsideHyperlink(
  source: string,
  runs: readonly CoveringRun[],
) {
  const first = runs[0]
  const last = runs.at(-1)
  if (!first || !last) throw new OoxmlError('invalid-document-edit')
  const startInsideRun = first.localFrom > 0
  const endInsideRun = last.localTo < last.anchor.wire.text.length
  const elements = parseXmlElements(source)
  for (const element of elements) {
    if (!isWord(element, 'hyperlink')) continue
    const startInside =
      element.start < first.anchor.runRange.start &&
      element.end > first.anchor.runRange.start
    const startCutsLink =
      startInsideRun &&
      element.start < first.anchor.runRange.end &&
      element.end > first.anchor.runRange.start
    const endInside =
      element.start < last.anchor.runRange.end &&
      element.end > last.anchor.runRange.end
    const endCutsLink =
      endInsideRun &&
      element.start < last.anchor.runRange.end &&
      element.end > last.anchor.runRange.start
    if (startInside || startCutsLink || endInside || endCutsLink) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

/**
 * Writes the boundary replacements: the covered runs are emitted between the
 * bookmark pair with interior markup preserved byte-for-byte. A covered run
 * holding pending work is folded through `effectiveRunView`, matching the
 * link writer — though the draft layer's conflict rules mean a mark rarely
 * meets one, the writer cannot assume the batch ordered around it.
 */
function writeMarkPair(
  document: OoxmlDocument,
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  runs: readonly CoveringRun[],
  bookmarkStart: string,
  bookmarkEnd: string,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  for (const covered of runs) {
    const { anchor, localFrom, localTo } = covered
    const needsHead = localFrom > 0
    const needsTail = localTo < anchor.wire.text.length
    if (!needsHead && !needsTail) {
      // A wholly covered run keeps its stored element; the pair's half at
      // that edge lands as a zero-width insertion beside it.
      if (covered.first) {
        setOverlayReplacement(
          overlay,
          `${anchor.wire.id}:defined-term:${String(occurrence)}:start`,
          {
            start: anchor.runRange.start,
            end: anchor.runRange.start,
            value: bookmarkStart,
          },
        )
      }
      if (covered.last) {
        setOverlayReplacement(
          overlay,
          `${anchor.wire.id}:defined-term:${String(occurrence)}:end`,
          {
            start: anchor.runRange.end,
            end: anchor.runRange.end,
            value: bookmarkEnd,
          },
        )
      }
      continue
    }
    const materialise = runHasPendingOverlay(overlay, anchor)
    const view: EffectiveRunView = materialise
      ? effectiveRunView(overlay, anchor, paragraph)
      : {
          paragraph,
          run: anchor,
          source: overlay.source,
          fragments: anchor.wire.preservedXmlFragments,
          consumedKeys: [],
        }
    const offsetBase = materialise ? 0 : covered.runStart
    const startCut = needsHead
      ? locateOffset(view.source, view.paragraph, offsetBase + localFrom)
      : undefined
    const endCut = needsTail
      ? locateOffset(view.source, view.paragraph, offsetBase + localTo)
      : undefined
    const headXml = needsHead
      ? runPieceXml(view.source, view.run, undefined, startCut)
      : ''
    const coveredXml = runPieceXml(view.source, view.run, startCut, endCut)
    const tailXml = needsTail
      ? runPieceXml(view.source, view.run, endCut, undefined)
      : ''
    const parts = [
      ...(needsHead ? [{ from: 0, to: localFrom }] : []),
      { from: localFrom, to: localTo },
      ...(needsTail ? [{ from: localTo, to: anchor.wire.text.length }] : []),
    ]
    const wireRuns: DocumentTextRunWire[] = parts.map((part, index) => ({
      id: index === 0 ? anchor.wire.id : allocateModelId(document, 'text-edit'),
      text: anchor.wire.text.slice(part.from, part.to),
      preservedXmlFragments: [...anchor.wire.preservedXmlFragments],
      ...(anchor.wire.styleId !== undefined
        ? { styleId: anchor.wire.styleId }
        : {}),
      ...(anchor.wire.hyperlinkTarget !== undefined
        ? { hyperlinkTarget: anchor.wire.hyperlinkTarget }
        : {}),
    }))
    const value = [
      headXml,
      covered.first ? bookmarkStart : '',
      coveredXml,
      covered.last ? bookmarkEnd : '',
      tailXml,
    ].join('')
    for (const key of view.consumedKeys) overlay.replacements.delete(key)
    setOverlayReplacement(
      overlay,
      `${anchor.wire.id}:defined-term:${String(occurrence)}`,
      { start: anchor.runRange.start, end: anchor.runRange.end, value },
    )
    const wireIndex = paragraph.wire.runs.indexOf(anchor.wire)
    if (wireIndex === -1) throw new OoxmlError('invalid-document-edit')
    paragraph.wire.runs.splice(wireIndex, 1, ...wireRuns)
    if (wireRuns.length > 1 && lineage) {
      recordSplitRun(
        lineage,
        anchor.wire,
        parts.map((part, index) => ({
          run: wireRuns[index],
          from: part.from,
          to: part.to,
        })),
      )
    }
  }
}
