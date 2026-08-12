export {
  documentModelWireSchema,
  type DocumentModelWire,
  type DocumentNumberingWire,
  type DocumentParagraphWire,
  type DocumentRelationshipWire,
  type DocumentStoryWire,
  type DocumentStyleWire,
  type DocumentTextRunWire,
  type PreservedDocumentXmlFragment,
} from '@obiter/contracts'

export { createBlankDocx } from './blank'
export { validateCommentAnchor } from './comment-anchors'
export { isPackageImagePartName, readPackageImagePart } from './package-part'
export { resolveRelationshipTarget } from './parts/rels'
export * from './collaboration-merge'
export * from './equivalence'
export * from './model'
export * from './model-json'
export * from './parse'
export * from './serialise'
export * from './tracked-change-decisions'
