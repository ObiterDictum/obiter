export const OOXML_MAX_ENTRIES = 768
export const OOXML_MAX_UNCOMPRESSED_BYTES = 72 * 1024 * 1024
export const OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES = 24 * 1024 * 1024
export const OOXML_MAX_COMPRESSION_RATIO = 14
export const OOXML_INFLATE_CONCURRENCY = 3
export const OOXML_MIN_RATIO_COMPRESSED_BYTES = 256

export interface OoxmlPackageLimits {
  maxEntries: number
  maxUncompressedBytes: number
  maxEntryUncompressedBytes: number
  maxCompressionRatio: number
  inflateConcurrency: number
  minRatioCompressedBytes: number
}

export const DEFAULT_OOXML_PACKAGE_LIMITS: OoxmlPackageLimits = {
  maxEntries: OOXML_MAX_ENTRIES,
  maxUncompressedBytes: OOXML_MAX_UNCOMPRESSED_BYTES,
  maxEntryUncompressedBytes: OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  maxCompressionRatio: OOXML_MAX_COMPRESSION_RATIO,
  inflateConcurrency: OOXML_INFLATE_CONCURRENCY,
  minRatioCompressedBytes: OOXML_MIN_RATIO_COMPRESSED_BYTES,
}
