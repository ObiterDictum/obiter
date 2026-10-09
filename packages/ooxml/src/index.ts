export {
  documentModelWireSchema,
  type DocumentFieldWire,
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
export { createSyntheticDocx } from './synthetic-document'
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
export { imageExtensionForContentType } from './structure-package'
export {
  buildFootnoteReferenceRunXml,
  buildFootnoteSeparatorXml,
  buildFootnoteXml,
  buildInlineDrawingXml,
  FOOTNOTES_PART_NAME,
  buildTableParagraphXml,
  buildTableXml,
  decideTablePlacement,
  IMAGE_RELATIONSHIP_TYPE,
  type TablePlacement,
  type TablePlacementContext,
} from './structure-xml'
export {
  paragraphOutlineLevel,
  tableOfContentsEntries,
  type TableOfContentsEntry,
} from './table-of-contents-entries'
export {
  entryParagraphWire,
  FALLBACK_TAB_POSITION_TWIPS,
  type TocEntry,
} from './table-of-contents-xml'
export {
  tableOfAuthoritiesCitations,
  isGeneratedFieldResultStyle,
  type AuthorityOccurrence,
  type TableOfAuthoritiesEntry,
} from './table-of-authorities-entries'
export {
  tableAuthorityMarkWires,
  toaEntryParagraphWire,
  toaHeadingParagraphWire,
  type ToaEntry,
} from './table-of-authorities-xml'
export { decodeXmlReferences, findXmlTagEnd } from './xml-lexemes'
export {
  fieldInstructionsInXml,
  isTableOfAuthoritiesField,
  tableAuthorityMarkMatches,
} from './field-instructions'
export * from './collaboration-merge'
export * from './document-identity'
export * from './document-lineage'
export * from './equivalence'
export * from './model'
export * from './model-run-range-edits'
export type { RunEmphasis } from './model-property-edits'
export {
  patchRunEmphasisXml,
  patchParagraphFormatXml,
} from './model-property-edits'
export { insertPropertyChild, stripPropertyChild } from './property-xml'
export {
  A4_PAGE_TWIPS,
  activeSectionXml,
  patchSectionPropertiesXml,
  splitSectionHistory,
  type SectionMarginPatch,
  type SectionPropertiesPatch,
} from './section-xml'
export {
  buildOverrideFragment,
  hasPureStartOverride,
  levelStartOverride,
} from './numbering-edits'
export type { ImportedThreadReply } from './comments-package'
export * from './model-json'
export * from './parse'
export * from './serialise'
export * from './tracked-change-decisions'
