import {
  isValidXmlText,
  type DocumentEditRun,
  type DocumentModelWire,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { insertParagraphAfter } from './model-paragraph-edits'
import {
  patchParagraphFormatXml,
  patchRunEmphasisXml,
  type ParagraphFormat,
  type RunEmphasis,
} from './model-property-edits'
import {
  patchParagraphNumberingXml,
  resolveParagraphNumbering,
  type ParagraphNumbering,
} from './numbering-edits'
import { escapeXmlAttribute, setOverlayReplacement } from './parts/overlay'
import {
  recordDeletedParagraph,
  type LineageRecorder,
} from './document-lineage'
import { granularRunEdit } from './tracked-edit-granular'
import {
  setTrackedProperties,
  setTrackedStyleProperties,
} from './tracked-edit-properties'
import {
  foldRprIntoRun,
  paragraphMarkDeletionReplacement,
  renameTextElements,
  replaceRunText,
  stripPropertyChange,
  wordPrefix,
} from './tracked-edit-xml'

export type TrackedEditContext = {
  author: string
  date: string
}

/**
 * A tracked-change element the writer just created, addressed by the persisted
 * OOXML change id (`w:id`). It is the only cross-version identity for content
 * that serialization wraps in `w:ins`/`w:del` and the parser therefore excludes
 * from the paragraph model.
 */
export type TrackedChangeCreated = {
  elementName: 'ins' | 'del' | 'rPrChange' | 'pPrChange'
  ooxmlId: string
}

export function createTrackedEditWriter(
  document: OoxmlDocument,
  context: TrackedEditContext,
) {
  if (
    context.author.length === 0 ||
    !isValidXmlText(context.author) ||
    !isValidXmlText(context.date) ||
    !isCanonicalIsoTimestamp(context.date)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  let nextChangeId = allocateFirstChangeId(document)
  let created: TrackedChangeCreated[] = []
  // Change ids whose element ended up nested inside a `w:ins`/`w:del` piece —
  // a property marker folded into a text replacement. The parser lists only
  // top-level change elements, so a nested id names a change nobody can
  // decide; the lineage withdraws it from the batch's reversal groups.
  let consumed: string[] = []
  const attributes = (
    prefix: string,
    elementName: TrackedChangeCreated['elementName'],
  ) => {
    const id = String(nextChangeId)
    nextChangeId += 1
    created.push({ elementName, ooxmlId: id })
    return `${prefix}:id="${id}" ${prefix}:author="${escapeXmlAttribute(context.author)}" ${prefix}:date="${escapeXmlAttribute(context.date)}"`
  }

  return {
    replaceRunText(anchor: TextRunAnchor, text: string) {
      const part = requireEditablePart(document, anchor.partName)
      const source = part.overlay.source
      const prefix = wordPrefix(source, anchor.runRange, 'r')
      const trackedProperties = part.overlay.replacements.get(
        `${anchor.wire.id}:tracked-properties`,
      )
      // A pending property change rewrites the whole run's rPr: the whole-run
      // path folds it into the inserted run, where a granular split would put
      // the new properties on the ins piece alone and leave the untouched
      // pieces carrying the old ones.
      const edit = granularRunEdit(
        source,
        anchor,
        text,
        prefix,
        trackedProperties !== undefined,
      )
      if (edit.kind === 'noop') return
      if (edit.kind === 'pieces') {
        let value = edit.prefixRun ?? ''
        // A substitution records its removed side before its inserted side,
        // the order Word writes and the pair a reversal drains as one unit.
        if (edit.deletedRun) {
          value += `<${prefix}:del ${attributes(prefix, 'del')}>${edit.deletedRun}</${prefix}:del>`
        }
        if (edit.insertedRun) {
          value += `<${prefix}:ins ${attributes(prefix, 'ins')}>${edit.insertedRun}</${prefix}:ins>`
        }
        value += edit.suffixRun ?? ''
        setOverlayReplacement(part.overlay, `${anchor.wire.id}:tracked-text`, {
          start: anchor.runRange.start,
          end: anchor.runRange.end,
          value,
        })
        anchor.wire.text = text
        part.dirty = true
        return
      }
      // Both tracked branches retain the complete run, so unique-identity
      // children such as bookmark and comment range markers are duplicated.
      // Hoisting those children needs a separate identity-preservation design.
      const oldRun = renameTextElements(
        source.slice(anchor.runRange.start, anchor.runRange.end),
        anchor,
        'delText',
      )
      let newRun = replaceRunText(source, anchor, text)
      if (trackedProperties) {
        part.overlay.replacements.delete(`${anchor.wire.id}:tracked-properties`)
        // The inserted run takes the patched properties without the pending
        // marker — a marker inside `w:ins` is not a listed change — and the
        // id it was allocated with is consumed rather than left dangling in
        // a reversal group.
        const markerId = trackedProperties.value.match(
          new RegExp(`${prefix}:id="(\\d+)"`, 'u'),
        )?.[1]
        newRun = foldRprIntoRun(
          newRun,
          stripPropertyChange(trackedProperties.value, prefix, 'rPr'),
          prefix,
          'rPr',
        )
        if (markerId !== undefined) consumed.push(markerId)
      }
      setOverlayReplacement(part.overlay, `${anchor.wire.id}:tracked-text`, {
        start: anchor.runRange.start,
        end: anchor.runRange.end,
        value: `<${prefix}:del ${attributes(prefix, 'del')}>${oldRun}</${prefix}:del><${prefix}:ins ${attributes(prefix, 'ins')}>${newRun}</${prefix}:ins>`,
      })
      anchor.wire.text = text
      part.dirty = true
    },

    insertParagraphAfter(
      story: DocumentModelWire['stories'][number],
      anchor: ParagraphAnchor,
      runs: readonly DocumentEditRun[],
      styleId: string | null | undefined,
      offset: number,
      paragraphFormat?: ParagraphFormat,
      lineage?: {
        recorder: LineageRecorder
        operationIndex: number
        intentId?: string
      },
      position?: 'after' | 'before',
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      insertParagraphAfter(
        document,
        story,
        anchor,
        runs,
        styleId,
        offset,
        {
          prefix,
          wrapRun: (run) =>
            `<${prefix}:ins ${attributes(prefix, 'ins')}>${run}</${prefix}:ins>`,
          paragraphFormat,
          ...(position ? { position } : {}),
        },
        lineage,
      )
    },

    deleteParagraph(
      anchor: ParagraphAnchor,
      lineage?: { recorder: LineageRecorder; operationIndex: number },
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const source = part.overlay.source
      if (anchor.runs.length === 0) {
        const story = document.model.stories.find(
          (item) => item.kind === 'document',
        )
        if (!story) throw new OoxmlError('model-node-not-editable')
        const prefix = wordPrefix(source, anchor.paragraphRange, 'p')
        setOverlayReplacement(
          part.overlay,
          `${anchor.wire.id}:tracked-delete`,
          paragraphMarkDeletionReplacement(
            source,
            anchor,
            prefix,
            attributes(prefix, 'del'),
          ),
        )
        story.paragraphs.splice(story.paragraphs.indexOf(anchor.wire), 1)
        part.dirty = true
        if (lineage) {
          recordDeletedParagraph(
            lineage.recorder,
            anchor.wire,
            lineage.operationIndex,
          )
        }
        return
      }
      for (const run of anchor.runs) {
        const prefix = wordPrefix(source, run.runRange, 'r')
        const deletedRun = renameTextElements(
          source.slice(run.runRange.start, run.runRange.end),
          run,
          'delText',
        )
        setOverlayReplacement(part.overlay, `${run.wire.id}:tracked-delete`, {
          start: run.runRange.start,
          end: run.runRange.end,
          value: `<${prefix}:del ${attributes(prefix, 'del')}>${deletedRun}</${prefix}:del>`,
        })
      }
      part.dirty = true
    },

    setRunStyle(anchor: TextRunAnchor, styleId: string | null) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.runRange, 'r')
      setTrackedStyleProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.runRange,
        propertiesRange: anchor.runPropertiesRange,
        propertiesName: 'rPr',
        styleName: 'rStyle',
        prefix,
        styleId,
        attributes: () => attributes(prefix, 'rPrChange'),
        wire: anchor.wire,
      })
    },

    setParagraphStyle(anchor: ParagraphAnchor, styleId: string | null) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      setTrackedStyleProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        styleName: 'pStyle',
        prefix,
        styleId,
        attributes: () => attributes(prefix, 'pPrChange'),
        wire: anchor.wire,
      })
    },

    setRunEmphasis(anchor: TextRunAnchor, emphasis: RunEmphasis) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.runRange, 'r')
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.runRange,
        propertiesRange: anchor.runPropertiesRange,
        propertiesName: 'rPr',
        prefix,
        attributes: () => attributes(prefix, 'rPrChange'),
        patch: (current) => patchRunEmphasisXml(current, emphasis),
      })
    },

    setParagraphNumbering(
      anchor: ParagraphAnchor,
      numbering: ParagraphNumbering,
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      // A start override points at a newly created or reused numbering
      // instance; resolve it before the tracked pPrChange is built so the
      // recorded change and the current state name the same instance.
      const resolved = resolveParagraphNumbering(document, numbering)
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        prefix,
        attributes: () => attributes(prefix, 'pPrChange'),
        patch: (current) => patchParagraphNumberingXml(current, resolved),
      })
    },

    setParagraphFormat(anchor: ParagraphAnchor, format: ParagraphFormat) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        prefix,
        attributes: () => attributes(prefix, 'pPrChange'),
        patch: (current) => patchParagraphFormatXml(current, format),
      })
    },

    /**
     * The marker attributes a fresh run piece's `w:rPrChange` carries. The
     * range-emphasis path allocates one per covered piece, so every split
     * piece's marker gets its own persisted `w:id` the way every other
     * tracked write does.
     */
    changeAttributes(prefix: string) {
      return attributes(prefix, 'rPrChange')
    },

    /**
     * The changes created since the previous call, in order. The lineage uses
     * them to name a reversal by persisted `w:id`, not by run position.
     */
    takeChanges() {
      const next = created
      created = []
      return next
    },

    /**
     * Change ids allocated since the previous call whose element was consumed
     * into nested markup, so a recorded reversal must drop them.
     */
    takeConsumedChanges() {
      const next = consumed
      consumed = []
      return next
    },
  }
}

function isCanonicalIsoTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value
}

/**
 * The next tracked-change id is one past the highest id already in the
 * document, never the lowest free one. A decided change's id is therefore not
 * reused by a later edit, so a stale rejection group can never name a different
 * change it happens to share an id with.
 */
function allocateFirstChangeId(document: OoxmlDocument) {
  let next = 0
  for (const { wire } of document.trackedChanges.values()) {
    const id = wire.ooxmlId
    if (id === undefined || !/^\d+$/u.test(id)) continue
    const value = Number(id)
    if (!Number.isSafeInteger(value)) continue
    if (value >= next) next = value + 1
  }
  return next
}
