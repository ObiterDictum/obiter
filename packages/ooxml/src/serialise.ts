import JSZip from 'jszip'
import { documentCommentSchema, type DocumentComment } from '@obiter/contracts'

import { placeCommentAnchors } from './comment-anchors'
import {
  appendProductComments,
  prepareCommentsPackage,
} from './comments-package'
import { OoxmlError, type OoxmlDocument, type SourcePart } from './model'
import { assertOoxmlPackageCentralDirectory } from './package-loader'
import { serialiseOverlay } from './parts/overlay'

const encoder = new TextEncoder()

export async function serialiseDocx(document: OoxmlDocument) {
  let bytes: Uint8Array
  try {
    const zip = new JSZip()
    for (const part of document.sourceParts.values()) {
      const payload = serialisePart(part)
      zip.file(part.name, payload, { binary: true })
    }
    bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      platform: 'DOS',
    })
  } catch {
    throw new OoxmlError('serialisation-failed')
  }
  // A published version must be a package the reader accepts: an insertion
  // can add parts (a media part, a relationships part) and grow dirty XML
  // beyond what the original payload sizes accounted for, so the loader's
  // limits are enforced against the completed archive before it is returned.
  assertOoxmlPackageCentralDirectory(bytes)
  return bytes
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
    trackedChanges: new Map(document.trackedChanges),
  }
}

function serialisePart(part: SourcePart) {
  if (!part.dirty) return part.originalPayload
  if (part.kind !== 'xml' || !part.overlay) {
    throw new Error('Dirty part has no XML overlay')
  }
  return encoder.encode(serialiseOverlay(part.overlay))
}
