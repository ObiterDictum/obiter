export {
  documentModelWireSchema,
  type DocumentModelWire,
  type DocumentNumberingLevelWire,
  type DocumentNumberingWire,
  type DocumentParagraphWire,
  type DocumentRelationshipWire,
  type DocumentStoryWire,
  type DocumentStyleWire,
  type DocumentTextRunWire,
  type PreservedDocumentXmlFragment,
} from '@obiter/contracts'

export { createBlankDocx } from './blank'
export {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  OOXML_INFLATE_CONCURRENCY,
  OOXML_MAX_COMPRESSION_RATIO,
  OOXML_MAX_ENTRIES,
  OOXML_MAX_ENTRY_UNCOMPRESSED_BYTES,
  OOXML_MAX_UNCOMPRESSED_BYTES,
  OOXML_MIN_RATIO_COMPRESSED_BYTES,
  type OoxmlPackageLimits,
} from './package-limits-defaults'
export {
  assertOoxmlPackageCentralDirectory,
  loadOoxmlZipEntries,
  packageLimitViolationMessage,
} from './package-loader'
export { getActiveInflateCount, mapWithConcurrency } from './inflate-pool'
export { validateCommentAnchor } from './comment-anchors'
export {
  isPackageImagePartName,
  readPackageImageParts,
  requestedImagePartName,
} from './package-part'
export { resolveRelationshipTarget } from './parts/rels'
export * from './collaboration-merge'
export * from './equivalence'
export * from './model'
export * from './model-json'
export * from './parse'
export * from './serialise'
export * from './tracked-change-decisions'
