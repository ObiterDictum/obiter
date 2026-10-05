export const OOXML_MAX_ENTRIES = 768
export const OOXML_MAX_UNCOMPRESSED_BYTES = 72 * 1024 * 1024
export const OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES = 24 * 1024 * 1024
// Measured worst case across a real-toolchain corpus (python-docx default
// template, the same styles parts Word ships): stylesWithEffects.xml at
// 32.2x, styles.xml at 28.8x — see scripts/generate-upload-corpus.py.
// Ceiling is 2x that worst case. Genuine bombs compress 100x+,
// so this still rejects them far below the line.
// The ratio guard stays alongside the absolute caps because it aborts before
// spending inflate CPU: a sub-cap entry can still be a CPU-DoS vector, and
// the absolute caps only bound memory after inflation.
export const OOXML_MAX_COMPRESSION_RATIO = 64
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
