import { z } from 'zod'
import {
  DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
  DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_TABLE_MAX_COLUMNS,
  DOCUMENT_EDIT_TABLE_MAX_ROWS,
  documentEditImageContentTypeSchema,
  type DocumentEditImageContentType,
  type DocumentEditOperation,
} from '@obiter/contracts'
import { imageExtensionForContentType } from '@obiter/ooxml'

/**
 * A structural insertion the workspace holds before save: a body-level table
 * after a stored paragraph, or an inline picture at a caret offset. Unlike a
 * `LocalInsert` these are not paragraphs the user types into — a table cell's
 * paragraphs stay outside the editable flow — so they get their own draft
 * slot, folded into the painted model by `document-structure-fold`.
 */
export type StructuralTableDraft = {
  id: string
  kind: 'table'
  paragraphId: string
  rows: number
  columns: number
}

export type StructuralImageDraft = {
  id: string
  kind: 'image'
  paragraphId: string
  offset: number
  contentType: DocumentEditImageContentType
  dataBase64: string
  widthPx: number
  heightPx: number
  name: string
}

export type StructuralDraft = StructuralTableDraft | StructuralImageDraft

/**
 * The persisted form of a structural draft, bounded to exactly the fields the
 * save serialises. E2: a persisted draft that fails to parse is silently
 * deleted, so the schema accepts nothing the operation cannot carry and the
 * state carries nothing the schema will not read back.
 */
export const structuralDraftSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('table'),
      paragraphId: z.string().min(1),
      rows: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_ROWS),
      columns: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_COLUMNS),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('image'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
      contentType: documentEditImageContentTypeSchema,
      dataBase64: z.string().min(1).max(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH),
      widthPx: z.number().int().min(1).max(DOCUMENT_EDIT_IMAGE_DIMENSION_MAX),
      heightPx: z.number().int().min(1).max(DOCUMENT_EDIT_IMAGE_DIMENSION_MAX),
      name: z.string().min(1).max(DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH),
    })
    .strict(),
])

/**
 * The persisted `structures` field: a malformed slot is dropped on its own
 * rather than failing the whole snapshot, so unrelated work — typed drafts
 * especially — survives a slot the writer no longer produces.
 */
export const structuralDraftsFieldSchema = z
  .array(z.unknown())
  .optional()
  .default([])
  .transform((entries): StructuralDraft[] =>
    entries.filter(
      (entry): entry is StructuralDraft =>
        structuralDraftSchema.safeParse(entry).success,
    ),
  )

/** The save operations the covered structural drafts produce, in draft order. */
export function structuralEditOperations(
  structures: readonly StructuralDraft[],
  deletedIds: ReadonlySet<string>,
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  for (const structure of structures) {
    if (deletedIds.has(structure.paragraphId)) continue
    if (structure.kind === 'table') {
      operations.push({
        type: 'insert_table',
        paragraphId: structure.paragraphId,
        rows: structure.rows,
        columns: structure.columns,
      })
      continue
    }
    operations.push({
      type: 'insert_image',
      paragraphId: structure.paragraphId,
      offset: structure.offset,
      contentType: structure.contentType,
      dataBase64: structure.dataBase64,
      widthPx: structure.widthPx,
      heightPx: structure.heightPx,
      name: structure.name,
    })
  }
  return operations
}

/**
 * The package part name a pending image resolves to in the folded model. It
 * cannot collide with a stored part — the server allocates
 * `word/media/image<N>.<ext>` — and it survives only until the save, when the
 * real part name replaces it.
 */
export function pendingImagePartName(draft: {
  id: string
  contentType: DocumentEditImageContentType
}) {
  return `word/media/obiter-pending-${draft.id}.${imageExtensionForContentType(draft.contentType)}`
}

/** The relationship target the same part carries from `word/document.xml`. */
export function pendingImageTarget(draft: {
  id: string
  contentType: DocumentEditImageContentType
}) {
  return pendingImagePartName(draft).slice('word/'.length)
}

export function decodeImageBytes(dataBase64: string) {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * Blob URLs for every pending image, keyed by its pending part name — the same
 * key `imagePartNameForDrawing` resolves in the folded model, so `PageDrawing`
 * paints it through the same lookup a reloaded image uses. The caller owns
 * revocation.
 */
export function pendingImageUrls(structures: readonly StructuralDraft[]) {
  const urls: Record<string, string> = {}
  for (const draft of structures) {
    if (draft.kind !== 'image') continue
    // SAFETY: the bytes were just allocated as a fresh Uint8Array, so its
    // buffer is a real ArrayBuffer, not a SharedArrayBuffer.
    const blob = new Blob(
      [decodeImageBytes(draft.dataBase64).buffer as ArrayBuffer],
      {
        type: draft.contentType,
      },
    )
    urls[pendingImagePartName(draft)] = URL.createObjectURL(blob)
  }
  return urls
}

export type ImageInsertFields = {
  contentType: DocumentEditImageContentType
  dataBase64: string
  widthPx: number
  heightPx: number
  name: string
}

const SIGNATURES: Array<{
  contentType: DocumentEditImageContentType
  bytes: number[]
}> = [
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { contentType: 'image/bmp', bytes: [0x42, 0x4d] },
]

/** The widest a freshly inserted picture paints; taller images scale with it. */
const PICTURE_MAX_WIDTH_PX = 600

/**
 * Scales a picked image to the page column and bounds both dimensions by the
 * contract's maximum. Width alone is not enough: a 1×20000 file scales to
 * 600×12,000,000 and would produce a draft the schema refuses, silently
 * deleting itself — and every sibling draft — on the next restore.
 */
export function scaleImageInsertSize(widthPx: number, heightPx: number) {
  const scale = Math.min(1, PICTURE_MAX_WIDTH_PX / widthPx)
  const clamp = (value: number) =>
    Math.min(
      DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
      Math.max(1, Math.round(value * scale)),
    )
  return { widthPx: clamp(widthPx), heightPx: clamp(heightPx) }
}

/**
 * Reads a picked image file into the fields an `insert_image` draft carries.
 * The declared type and the magic bytes must agree — a renamed file would
 * store bytes under the wrong content type — and the size is clamped to the
 * page column so a photograph does not blow the layout.
 */
export async function readImageInsert(
  file: File,
): Promise<ImageInsertFields | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const signature = SIGNATURES.find((entry) =>
    entry.bytes.every((value, index) => bytes[index] === value),
  )
  if (!signature || signature.contentType !== file.type) {
    return {
      error: 'Choose a PNG, JPEG, GIF or BMP image.',
    }
  }
  const dataBase64 = bytesToBase64(bytes)
  if (dataBase64.length > DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH) {
    return { error: 'That image is too large to insert.' }
  }
  // SAFETY: `file.arrayBuffer()` returns an ArrayBuffer and the Uint8Array is
  // built directly over it, so the buffer is never a SharedArrayBuffer.
  const size = await imageNaturalSize(
    new Blob([bytes.buffer as ArrayBuffer], { type: signature.contentType }),
  )
  if (!size) return { error: 'That file did not read as an image.' }
  const name = file.name.trim() || 'Picture'
  return {
    contentType: signature.contentType,
    dataBase64,
    ...scaleImageInsertSize(size.widthPx, size.heightPx),
    name: name.slice(0, DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH),
  }
}

function imageNaturalSize(
  blob: Blob,
): Promise<{ widthPx: number; heightPx: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { widthPx: image.naturalWidth, heightPx: image.naturalHeight }
          : null,
      )
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}
