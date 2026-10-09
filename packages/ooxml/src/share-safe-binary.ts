import type { SourcePart } from './model'
import { refuseShareSafe } from './share-safe-refusal'

/**
 * Binary payload policy: a kept image or font ships only when its bytes
 * parse as the format its part name declares, and for PNG, JPEG and GIF
 * the payload is rewritten metadata-free — every chunk or segment a
 * reader does not need to render the pixels is cut, so a `tEXt` record,
 * an EXIF block or a GIF comment cannot carry bytes across the boundary.
 * Formats this build cannot inspect — TIFF, WMF, EMF, obfuscated
 * `odttf` fonts — refuse rather than ship unverifiable payload.
 */

const IMAGE_FORMATS = new Map<string, string>([
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['gif', 'gif'],
  ['bmp', 'bmp'],
  ['ico', 'ico'],
])

const FONT_MAGICS: readonly (readonly number[])[] = [
  [0x00, 0x01, 0x00, 0x00], // TrueType
  [0x4f, 0x54, 0x54, 0x4f], // 'OTTO' — OpenType CFF
  [0x74, 0x72, 0x75, 0x65], // 'true'
  [0x74, 0x74, 0x63, 0x66], // 'ttcf'
]

function hasMagic(payload: Uint8Array, magic: readonly number[]) {
  return (
    payload.length >= magic.length &&
    magic.every((byte, index) => payload[index] === byte)
  )
}

function partExtension(part: SourcePart) {
  const dot = part.name.lastIndexOf('.')
  return dot === -1 ? '' : part.name.slice(dot + 1).toLowerCase()
}

/**
 * Inspects a binary part the inventory classified by its relationship.
 * Returns the payload the transform writes — identical bytes for
 * verifiable formats, a stripped copy for PNG/JPEG/GIF — or refuses.
 */
export function inspectBinaryPayload(
  part: SourcePart,
  relationshipTail: string,
): Uint8Array | undefined {
  const payload = part.originalPayload
  if (relationshipTail === 'font') {
    const extension = partExtension(part)
    if (extension === 'odttf') {
      refuseShareSafe(
        'opaque-payload',
        `obfuscated font ${part.name} cannot be inspected`,
      )
    }
    if (extension !== 'ttf' && extension !== 'otf' && extension !== 'ttc') {
      refuseShareSafe(
        'opaque-payload',
        `font part ${part.name} is not a format this build can verify`,
      )
    }
    if (!FONT_MAGICS.some((magic) => hasMagic(payload, magic))) {
      refuseShareSafe(
        'opaque-payload',
        `font part ${part.name} does not start with a font signature`,
      )
    }
    return undefined
  }
  const format = IMAGE_FORMATS.get(partExtension(part))
  if (format === undefined) {
    refuseShareSafe(
      'opaque-payload',
      `image part ${part.name} is not a format this build can verify`,
    )
  }
  switch (format) {
    case 'png':
      return stripPng(part, payload)
    case 'jpeg':
      return stripJpeg(part, payload)
    case 'gif':
      return stripGif(part, payload)
    case 'bmp':
      if (!hasMagic(payload, [0x42, 0x4d])) {
        refuseShareSafe(
          'opaque-payload',
          `image part ${part.name} does not start with a bitmap signature`,
        )
      }
      return undefined
    case 'ico':
      if (!hasMagic(payload, [0x00, 0x00, 0x01, 0x00])) {
        refuseShareSafe(
          'opaque-payload',
          `image part ${part.name} does not start with an icon signature`,
        )
      }
      return undefined
    default:
      refuseShareSafe(
        'opaque-payload',
        `image part ${part.name} is not a format this build can verify`,
      )
  }
}

/** PNG chunks a reader needs — ancillary metadata is absent by design. */
const PNG_KEPT_CHUNKS = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
])

function stripPng(part: SourcePart, payload: Uint8Array) {
  if (!hasMagic(payload, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    refuseShareSafe(
      'opaque-payload',
      `image part ${part.name} does not start with a PNG signature`,
    )
  }
  const kept: Uint8Array[] = [payload.slice(0, 8)]
  let cursor = 8
  let sawEnd = false
  while (cursor + 12 <= payload.length) {
    const length = new DataView(payload.buffer, payload.byteOffset).getUint32(
      cursor,
      false,
    )
    const type = String.fromCharCode(
      payload[cursor + 4]!,
      payload[cursor + 5]!,
      payload[cursor + 6]!,
      payload[cursor + 7]!,
    )
    const end = cursor + 12 + length
    if (end > payload.length) break
    // An unknown critical chunk (uppercase first letter) is not a shape a
    // reader can be assumed to skip.
    if (!PNG_KEPT_CHUNKS.has(type) && type.charCodeAt(0) < 0x61) {
      refuseShareSafe(
        'opaque-payload',
        `image part ${part.name} carries unknown PNG chunk ${type}`,
      )
    }
    if (PNG_KEPT_CHUNKS.has(type)) kept.push(payload.slice(cursor, end))
    if (type === 'IEND') {
      sawEnd = true
      cursor = end
      break
    }
    cursor = end
  }
  if (!sawEnd || cursor !== payload.length) {
    refuseShareSafe(
      'malformed-package',
      `image part ${part.name} is not well-formed PNG`,
    )
  }
  return concatenate(kept)
}

/**
 * JPEG segments a reader needs: the JFIF header, quantisation and Huffman
 * tables, frame headers, restart intervals, the scan payload and the
 * terminator. `APP1`–`APP15` (EXIF, XMP and friends) and comment segments
 * are dropped; arithmetic-coding tables stay because the scan needs them.
 */
const JPEG_KEPT_SEGMENTS = new Set([
  0xe0, // APP0 — JFIF header
  0xc4, // DHT
  0xcc, // DAC
  0xdb, // DQT
  0xdd, // DRI
])

function stripJpeg(part: SourcePart, payload: Uint8Array) {
  if (!hasMagic(payload, [0xff, 0xd8])) {
    refuseShareSafe(
      'opaque-payload',
      `image part ${part.name} does not start with a JPEG signature`,
    )
  }
  const kept: Uint8Array[] = [payload.slice(0, 2)]
  const view = new DataView(payload.buffer, payload.byteOffset)
  let cursor = 2
  let done = false
  while (cursor < payload.length) {
    // Standalone markers and fill bytes carry no segment.
    if (payload[cursor] !== 0xff || cursor + 1 >= payload.length) {
      refuseShareSafe(
        'malformed-package',
        `image part ${part.name} is not well-formed JPEG`,
      )
    }
    let marker = payload[cursor + 1]!
    while (marker === 0xff) {
      cursor += 1
      if (cursor + 1 >= payload.length) {
        refuseShareSafe(
          'malformed-package',
          `image part ${part.name} is not well-formed JPEG`,
        )
      }
      marker = payload[cursor + 1]!
    }
    const markerStart = cursor
    cursor += 2
    if (marker === 0xd9) {
      kept.push(payload.slice(markerStart, cursor))
      done = true
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(payload.slice(markerStart, cursor))
      continue
    }
    const length = view.getUint16(cursor, false)
    const end = cursor + length
    if (end > payload.length) {
      refuseShareSafe(
        'malformed-package',
        `image part ${part.name} is not well-formed JPEG`,
      )
    }
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8
    if (marker === 0xda) {
      // SOS: the compressed scan runs to the next non-restart marker or
      // the EOI — its bytes are entropy, not addressable structure.
      kept.push(payload.slice(markerStart, end))
      let scan = end
      while (scan < payload.length) {
        if (
          payload[scan] === 0xff &&
          payload[scan + 1] !== 0x00 &&
          !(payload[scan + 1]! >= 0xd0 && payload[scan + 1]! <= 0xd7)
        ) {
          break
        }
        scan += payload[scan] === 0xff ? 2 : 1
      }
      kept.push(payload.slice(end, scan))
      cursor = scan
      continue
    }
    if (isFrameHeader || JPEG_KEPT_SEGMENTS.has(marker)) {
      kept.push(payload.slice(markerStart, end))
    }
    cursor = end
  }
  if (!done || cursor !== payload.length) {
    refuseShareSafe(
      'malformed-package',
      `image part ${part.name} is not well-formed JPEG`,
    )
  }
  return concatenate(kept)
}

/**
 * GIF blocks a reader needs: header, screen descriptor, palettes, image
 * descriptors, image data, graphics-control extensions and the trailer.
 * Comment, plain-text and application extensions — the metadata carriers —
 * are dropped.
 */
function stripGif(part: SourcePart, payload: Uint8Array) {
  if (
    !hasMagic(payload, [0x47, 0x49, 0x46, 0x38]) ||
    (payload[4] !== 0x37 && payload[4] !== 0x39) ||
    payload[5] !== 0x61
  ) {
    refuseShareSafe(
      'opaque-payload',
      `image part ${part.name} does not start with a GIF signature`,
    )
  }
  if (payload.length < 13) {
    refuseShareSafe(
      'malformed-package',
      `image part ${part.name} is not well-formed GIF`,
    )
  }
  const kept: Uint8Array[] = []
  const descriptor = payload[10]!
  const globalTable =
    (descriptor & 0x80) !== 0 ? 3 * 2 ** ((descriptor & 7) + 1) : 0
  const headerEnd = 13 + globalTable
  if (headerEnd > payload.length) {
    refuseShareSafe(
      'malformed-package',
      `image part ${part.name} is not well-formed GIF`,
    )
  }
  kept.push(payload.slice(0, headerEnd))
  let cursor = headerEnd
  let done = false
  const skipSubBlocks = (start: number) => {
    let position = start
    while (position < payload.length) {
      const size = payload[position]!
      position += 1 + size
      if (size === 0) break
    }
    return position
  }
  while (cursor < payload.length) {
    const marker = payload[cursor]!
    if (marker === 0x3b) {
      kept.push(payload.slice(cursor, cursor + 1))
      cursor += 1
      done = true
      break
    }
    if (marker === 0x2c) {
      // Image descriptor + optional local palette + LZW data sub-blocks.
      if (cursor + 10 > payload.length) break
      const descriptorByte = payload[cursor + 9]!
      const localTable =
        (descriptorByte & 0x80) !== 0 ? 3 * 2 ** ((descriptorByte & 7) + 1) : 0
      const dataStart = cursor + 10 + localTable
      if (dataStart >= payload.length) break
      const dataEnd = skipSubBlocks(dataStart + 1)
      kept.push(payload.slice(cursor, dataEnd))
      cursor = dataEnd
      continue
    }
    if (marker === 0x21 && cursor + 2 <= payload.length) {
      const label = payload[cursor + 1]!
      const end = skipSubBlocks(cursor + 2)
      if (end > payload.length) break
      // 0xF9 graphics-control extensions carry rendering state; the rest
      // are metadata channels.
      if (label === 0xf9) kept.push(payload.slice(cursor, end))
      cursor = end
      continue
    }
    break
  }
  if (!done || cursor !== payload.length) {
    refuseShareSafe(
      'malformed-package',
      `image part ${part.name} is not well-formed GIF`,
    )
  }
  return concatenate(kept)
}

function concatenate(fragments: readonly Uint8Array[]) {
  const total = fragments.reduce((sum, fragment) => sum + fragment.length, 0)
  const combined = new Uint8Array(total)
  let cursor = 0
  for (const fragment of fragments) {
    combined.set(fragment, cursor)
    cursor += fragment.length
  }
  return combined
}

/**
 * The verifier's half of the binary check: the emitted payload must strip
 * to itself — a metadata chunk in the output means the transform failed.
 */
export function verifyBinaryPayload(
  part: SourcePart,
  relationshipTail: string,
) {
  const rewritten = inspectBinaryPayload(part, relationshipTail)
  if (
    rewritten !== undefined &&
    (rewritten.length !== part.originalPayload.length ||
      !rewritten.every((byte, index) => byte === part.originalPayload[index]))
  ) {
    refuseShareSafe(
      'unverifiable-output',
      `binary part ${part.name} still carries metadata payload`,
    )
  }
}
