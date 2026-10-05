import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import type { XmlOverlay } from './parts/overlay'

export function requireEditablePart(
  document: OoxmlDocument,
  partName: string,
): SourcePart & { kind: 'xml'; overlay: XmlOverlay } {
  const part = document.sourceParts.get(partName)
  if (!isEditablePart(part)) {
    throw new OoxmlError('model-node-not-editable')
  }
  return part
}

function isEditablePart(
  part: SourcePart | undefined,
): part is SourcePart & { kind: 'xml'; overlay: XmlOverlay } {
  return part?.kind === 'xml' && part.overlay !== undefined
}
