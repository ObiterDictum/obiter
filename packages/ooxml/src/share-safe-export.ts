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
 * markers go, external hyperlinks unwrap to their text, attached templates
 * detach, package metadata is emptied or canonicalised, settings lose their
 * provenance elements, and editing provenance (`rsid*`/`w14` ids) leaves
 * every start tag.
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
 *  - `customXml` payloads and every relationship type outside the
 *    allow-list;
 *  - ambiguous structure: case-variant part names, duplicated unique
 *    relationships, a part declared under two roles, dangling pointers;
 *  - fields that fetch (`INCLUDETEXT`, `INCLUDEPICTURE`, `LINK`, `DDE`,
 *    `HYPERLINK`, …): the instruction embeds the address.
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
    refuseShareSafe('the sanitising transform could not be applied')
  }
  const bytes = await serialiseDocx(copy)
  await verifyShareSafePackage(bytes)
  return bytes
}
