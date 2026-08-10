import JSZip from 'jszip'

import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { serialiseOverlay } from './parts/overlay'

const encoder = new TextEncoder()

export async function serialiseDocx(document: OoxmlDocument) {
  try {
    const zip = new JSZip()
    for (const part of document.sourceParts.values()) {
      const payload = serialisePart(part)
      zip.file(part.name, payload, { binary: true })
    }
    return await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      platform: 'DOS',
    })
  } catch {
    throw new OoxmlError('serialisation-failed')
  }
}

function serialisePart(part: SourcePart) {
  if (!part.dirty) return part.originalPayload
  if (part.kind !== 'xml' || !part.overlay) {
    throw new Error('Dirty part has no XML overlay')
  }
  return encoder.encode(serialiseOverlay(part.overlay))
}
