import {
  DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
  DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH,
  imageExtensionForContentType,
  type DocumentEditImageContentType,
} from '@obiter/contracts'
import type { StructuralDraft } from './document-structural-drafts'

export type ImageInsertFields = {
  contentType: DocumentEditImageContentType
  dataBase64: string
  widthPx: number
  heightPx: number
  name: string
}

export function pendingImagePartName(draft: {
  id: string
  contentType: DocumentEditImageContentType
}) {
  return `word/media/obiter-pending-${draft.id}.${imageExtensionForContentType(draft.contentType)}`
}

export function pendingImageTarget(draft: {
  id: string
  contentType: DocumentEditImageContentType
}) {
  return pendingImagePartName(draft).slice('word/'.length)
}

function decodeImageBytes(dataBase64: string) {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function pendingImageUrls(structures: readonly StructuralDraft[]) {
  const urls: Record<string, string> = {}
  for (const draft of structures) {
    if (draft.kind !== 'image') continue
    // SAFETY: the bytes were just allocated as a fresh Uint8Array, so its
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

const SIGNATURES: Array<{
  contentType: DocumentEditImageContentType
  bytes: number[]
}> = [
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { contentType: 'image/bmp', bytes: [0x42, 0x4d] },
]

const PICTURE_MAX_WIDTH_PX = 600

export function scaleImageInsertSize(widthPx: number, heightPx: number) {
  const scale = Math.min(1, PICTURE_MAX_WIDTH_PX / widthPx)
  const clamp = (value: number) =>
    Math.min(
      DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
      Math.max(1, Math.round(value * scale)),
    )
  return { widthPx: clamp(widthPx), heightPx: clamp(heightPx) }
}

export async function readImageInsert(
  file: File,
): Promise<ImageInsertFields | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length > (DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH / 4) * 3) {
    return { error: 'That image is too large to insert.' }
  }
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
