import type { OoxmlDocument } from './model'
import { serialiseDocx, cloneDocument } from './serialise'
import { planShareSafeCopy } from './share-safe-inventory'
import { refuseShareSafe, ShareSafeRefusal } from './share-safe-refusal'
import { applyShareSafePlan } from './share-safe-transform'
import { verifyShareSafePackage } from './share-safe-verify'

export { ShareSafeRefusal }

/**
 * The share-safe policy: enumerate what ships, then prove nothing else did.
 *
 * `planShareSafeCopy` walks the package graph from `_rels/.rels` and
 * classifies every part by the relationship type that reaches it — a part
 * the allow-list cannot place is dropped (unreferenced payload) or refused
 * (declared but unverifiable). The same classification owns the XML surface
 * scans: every kept part is checked for revision markup in any shape —
 * tracked changes, property/section/table/customXml revisions, range
 * markers, `w:delText` carriers — for hidden content, opaque inclusions,
 * undeclared relationship pointers, and field instructions that fetch
 * outside the package.
 *
 * `applyShareSafePlan` then rewrites the clone: comment surfaces and their
 * markers go, `customXml` stores and glossary parts drop with the markup
 * that bound to them, external hyperlinks unwrap to their text, attached
 * templates detach, package metadata is emptied or canonicalised, settings
 * lose their provenance elements, and editing provenance (`rsid*`/`w14`
 * ids) leaves every start tag. Kept XML is re-emitted canonically from the
 * parsed element model — nothing lexical the parser never modelled can
 * reach the output — and image payloads are re-serialised metadata-free.
 *
 * `verifyShareSafePackage` re-parses the finished bytes and re-runs the
 * inventory against them — the output must already be clean, because the
 * copy a recipient opens is the only thing that counts.
 *
 * Refused classes (the package would keep material this build cannot prove
 * clean):
 *  - tracked changes and any revision markup: deleted text stays
 *    recoverable, and accepting or rejecting guesses at legal content;
 *  - hidden runs (`w:vanish`, `w:webHidden` on a run);
 *  - embedded objects, ActiveX controls, `w:altChunk`, OLE: opaque payloads;
 *  - external relationships other than detachable hyperlinks and attached
 *    templates — an external image or included text would fetch;
 *  - every relationship type outside the allow-list or the drop set;
 *  - ambiguous structure: case-variant part names, duplicated unique
 *    relationships, a part declared under two roles, dangling pointers;
 *  - fields that fetch (`INCLUDETEXT`, `INCLUDEPICTURE`, `LINK`, `DDE`,
 *    `HYPERLINK`, …): the instruction embeds the address.
 *
 * Module ownership — which allow-list file owns which namespace or part
 * class, and what rewrites it:
 *  - WordprocessingML: `share-safe-word-vocabulary` (elements) and
 *    `share-safe-word-attributes` (attributes, split into the
 *    `share-safe-word-attribute-*` modules for value shapes) own the
 *    allow-list; `share-safe-word-classes` owns the revision, hidden and
 *    pointer classes; `share-safe-word-content` rewrites the part.
 *  - DrawingML and WordprocessingDrawing: `share-safe-drawing-vocabulary`,
 *    `share-safe-drawing-attributes`, `share-safe-drawing-attribute-bounds`.
 *  - Math (OMML): `share-safe-math-vocabulary`, `share-safe-math-attributes`.
 *  - Preset colours and shapes: `share-safe-preset-attributes`,
 *    `share-safe-preset-colors`.
 *  - Package declarations (`_rels`, `[Content_Types].xml`):
 *    `share-safe-declarations`; canonical bytes: `share-safe-canonical`.
 *  - Document properties (`docProps`): `share-safe-metadata`.
 *  The verdicts these lists feed live in `share-safe-policy`; the per-part
 *  content pass in `share-safe-content`; the part graph in
 *  `share-safe-inventory`; emission in `share-safe-emit`; and the independent
 *  byte, binary and whole-output verification in `share-safe-bytecheck`,
 *  `share-safe-binary` and `share-safe-verify`.
 */
export async function buildShareSafeDocx(
  document: OoxmlDocument,
): Promise<Uint8Array> {
  const copy = cloneDocument(document)
  const plan = planShareSafeCopy(copy)
  try {
    applyShareSafePlan(copy, plan)
  } catch (error) {
    if (error instanceof ShareSafeRefusal) throw error
    refuseShareSafe(
      'unverifiable-output',
      'the sanitising transform could not be applied',
    )
  }
  const bytes = await serialiseDocx(copy)
  await verifyShareSafePackage(bytes)
  return bytes
}
