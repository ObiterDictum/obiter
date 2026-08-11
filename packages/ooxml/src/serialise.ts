import JSZip from 'jszip'
import { documentCommentSchema, type DocumentComment } from '@obiter/contracts'

import { placeCommentAnchors } from './comment-anchors'
import {
  appendProductComments,
  prepareCommentsPackage,
} from './comments-package'
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

export async function serialiseDocxWithComments(
  document: OoxmlDocument,
  comments: readonly DocumentComment[],
) {
  if (comments.length === 0) return serialiseDocx(document)

  try {
    const validatedComments = comments.map((comment) =>
      documentCommentSchema.parse(comment),
    )
    const exportedDocument = cloneDocument(document)
    const prepared = prepareCommentsPackage(exportedDocument, validatedComments)
    placeCommentAnchors(exportedDocument, prepared.allocated)
    appendProductComments(
      exportedDocument,
      prepared.partName,
      prepared.allocated,
    )
    return await serialiseDocx(exportedDocument)
  } catch (error) {
    if (error instanceof OoxmlError) throw error
    throw new OoxmlError('comment-export-failed')
  }
}

function cloneDocument(document: OoxmlDocument): OoxmlDocument {
  return {
    model: document.model,
    sourceParts: new Map(
      [...document.sourceParts].map(([name, part]) => [
        name,
        {
          ...part,
          overlay: part.overlay
            ? {
                source: part.overlay.source,
                replacements: new Map(part.overlay.replacements),
              }
            : undefined,
          trackedChanges: [...part.trackedChanges],
        },
      ]),
    ),
    textRunAnchors: new Map(document.textRunAnchors),
    paragraphAnchors: new Map(document.paragraphAnchors),
  }
}

function serialisePart(part: SourcePart) {
  if (!part.dirty) return part.originalPayload
  if (part.kind !== 'xml' || !part.overlay) {
    throw new Error('Dirty part has no XML overlay')
  }
  return encoder.encode(serialiseOverlay(part.overlay))
}
