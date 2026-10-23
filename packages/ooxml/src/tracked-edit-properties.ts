import type { OoxmlDocument, XmlElementRange } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { setOverlayReplacement } from './parts/overlay'
import {
  appendPropertyChange,
  extractInsertedRunRpr,
  foldRprIntoInsertedRun,
  foldRprIntoTrackedText,
  mergeTrackedProperties,
  patchStyleChild,
  stripPropertyChange,
} from './tracked-edit-xml'

/**
 * The property-change half of the tracked-edit writer: `rPr` and `pPr`
 * patches recorded as `w:rPrChange`/`w:pPrChange` markers, and their merge
 * rules when a text replacement on the same node has already claimed the
 * run's fragment. The writer calls these through `createTrackedEditWriter`;
 * this module exists so the writer stays under the file-size ceiling.
 */

export function setTrackedProperties(
  document: OoxmlDocument,
  input: {
    id: string
    partName: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'rPr' | 'pPr'
    prefix: string
    // Lazily allocated: a distributed or merged marker set needs one id per
    // piece and a merged path needs none, so callers defer the allocation.
    attributes: () => string
    patch: (current: string) => string
  },
) {
  const part = requireEditablePart(document, input.partName)
  const previous = input.propertiesRange
    ? part.overlay.source.slice(
        input.propertiesRange.start,
        input.propertiesRange.end,
      )
    : `<${input.prefix}:${input.propertiesName}/>`

  // A tracked text replacement on the same node covers the whole run,
  // including the properties element. When both fire in one batch the
  // property change distributes over every piece that survives an accept —
  // the shared runs and the inserted run each carry the patch with their own
  // change marker — so the order the operations ran in cannot strand it on
  // the inserted text alone.
  const trackedText = part.overlay.replacements.get(`${input.id}:tracked-text`)
  if (trackedText) {
    const distributed = foldRprIntoTrackedText(
      trackedText.value,
      input.prefix,
      input.propertiesName,
      input.patch,
      input.attributes,
    )
    if (distributed === undefined) {
      // Not a piece sequence this writer built: keep the single host, the
      // inserted run or the deleted run when nothing survives.
      const currentRpr = extractInsertedRunRpr(
        trackedText.value,
        input.prefix,
        input.propertiesName,
      )
      const patched = appendPropertyChange(
        input.patch(
          stripPropertyChange(currentRpr, input.prefix, input.propertiesName),
        ),
        input.prefix,
        input.propertiesName,
        input.attributes(),
        previous,
      )
      part.overlay.replacements.set(`${input.id}:tracked-text`, {
        ...trackedText,
        value: foldRprIntoInsertedRun(
          trackedText.value,
          patched,
          input.prefix,
          input.propertiesName,
        ),
      })
      part.dirty = true
      return
    }
    part.overlay.replacements.set(`${input.id}:tracked-text`, {
      ...trackedText,
      value: distributed,
    })
    part.dirty = true
    return
  }

  const key = `${input.id}:tracked-properties`
  const existing = part.overlay.replacements.get(key)
  if (existing) {
    part.overlay.replacements.set(key, {
      ...existing,
      value: mergeTrackedProperties(
        existing.value,
        input.prefix,
        input.propertiesName,
        input.patch,
      ),
    })
    part.dirty = true
    return
  }

  const current = appendPropertyChange(
    input.patch(previous),
    input.prefix,
    input.propertiesName,
    input.attributes(),
    previous,
  )
  setOverlayReplacement(part.overlay, key, {
    start: input.propertiesRange?.start ?? input.nodeRange.startTagEnd,
    end: input.propertiesRange?.end ?? input.nodeRange.startTagEnd,
    value: current,
  })
  part.dirty = true
}

export function setTrackedStyleProperties(
  document: OoxmlDocument,
  input: {
    id: string
    partName: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'rPr' | 'pPr'
    styleName: 'pStyle' | 'rStyle'
    prefix: string
    styleId: string | null
    attributes: () => string
    wire: { styleId?: string }
  },
) {
  setTrackedProperties(document, {
    id: input.id,
    partName: input.partName,
    nodeRange: input.nodeRange,
    propertiesRange: input.propertiesRange,
    propertiesName: input.propertiesName,
    prefix: input.prefix,
    attributes: input.attributes,
    patch: (current) =>
      patchStyleChild(
        current,
        input.prefix,
        input.propertiesName,
        input.styleName,
        input.styleId,
      ),
  })
  if (input.styleId === null) delete input.wire.styleId
  else input.wire.styleId = input.styleId
}
