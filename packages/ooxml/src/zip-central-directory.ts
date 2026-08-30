const EOCD_SIGNATURE = 0x06054b50
const CD_SIGNATURE = 0x02014b50

export type PackageLimitViolation =
  'entries' | 'uncompressed-total' | 'entry-uncompressed' | 'compression-ratio'

export interface ZipCentralDirectoryEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  localHeaderOffset: number
}

export interface ZipCentralDirectory {
  entries: ZipCentralDirectoryEntry[]
  totalUncompressedBytes: number
}

export function parseZipCentralDirectory(
  input: Uint8Array,
): ZipCentralDirectory {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const eocdOffset = findEocdOffset(view)
  if (eocdOffset === null)
    throw new Error('ZIP end of central directory not found')

  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  const entries: ZipCentralDirectoryEntry[] = []
  let offset = centralDirectoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > view.byteLength) {
      throw new Error('ZIP central directory truncated')
    }
    if (view.getUint32(offset, true) !== CD_SIGNATURE) {
      throw new Error('ZIP central directory entry signature invalid')
    }

    const compressionMethod = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraFieldLength = view.getUint16(offset + 30, true)
    const fileCommentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const nameStart = offset + 46
    const nameEnd = nameStart + fileNameLength
    if (nameEnd > view.byteLength) {
      throw new Error('ZIP central directory filename truncated')
    }

    const nameBytes = input.subarray(nameStart, nameEnd)
    const name = new TextDecoder().decode(nameBytes)
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
    })
    totalUncompressedBytes += uncompressedSize
    offset = nameEnd + extraFieldLength + fileCommentLength
  }

  return { entries, totalUncompressedBytes }
}

export function assertZipCentralDirectoryLimits(
  directory: ZipCentralDirectory,
  limits: {
    maxEntries: number
    maxUncompressedBytes: number
    maxEntryUncompressedBytes: number
    maxCompressionRatio: number
    minRatioCompressedBytes: number
  },
): PackageLimitViolation | null {
  if (directory.entries.length > limits.maxEntries) return 'entries'
  if (directory.totalUncompressedBytes > limits.maxUncompressedBytes) {
    return 'uncompressed-total'
  }

  for (const entry of directory.entries) {
    if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
      return 'entry-uncompressed'
    }
    if (
      entry.compressedSize >= limits.minRatioCompressedBytes &&
      entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio
    ) {
      return 'compression-ratio'
    }
  }

  return null
}

function findEocdOffset(view: DataView): number | null {
  const minOffset = Math.max(0, view.byteLength - 22 - 65_535)
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  return null
}
