import { insertPlainText, removeInsert } from './document-edits'
import { mergeEmphasis, paragraphNumPr } from './document-format-edits'
import { paragraphFormatOf } from './document-paragraph-format'
import {
  emphasisSlotKey,
  removeDraftSlots,
  type DraftState,
  type StructureKind,
} from './document-save-plan'
import type { SaveBaseline } from './document-baseline-identity-keys'
import {
  pendingDeleteId,
  pendingRunAddressId,
  pendingRunId,
  pendingUnresolvedRunId,
  savedIdentities,
  sentInsertRunIds,
} from './document-baseline-identity-keys'
import {
  reversalRunTexts,
  runText,
  storyParagraph,
} from './document-baseline-lineage'
import {
  addTrackedRejection,
  preEmphasisForRange,
  preEmphasisForRun,
  restoreInsert,
  reversalParagraphFormat,
  sameParagraphFormat,
  sectionReversal,
} from './document-baseline-reversal'

const STRUCTURE_KIND_REMOVABLE = {
  table: false,
  image: false,
  link: true,
  'cross-reference': false,
  'page-number': false,
  footnote: false,
  'table-of-contents': false,
  'table-of-authorities': false,
  'table-of-authorities-refresh': false,
  'defined-term': false,
} satisfies Record<StructureKind, boolean>

export function translateSnapshot(
  snapshot: DraftState,
  baseline: SaveBaseline,
): DraftState | null {
  const next = structuredClone(snapshot)
  const identities = savedIdentities(baseline)
  const insertedRunIds = sentInsertRunIds(baseline)

  for (const slot of baseline.covered) {
    switch (slot.kind) {
      case 'run-text': {
        const reversal = identities.runReversals.get(slot.runId)
        if (reversal) {
          delete next.drafts[slot.runId]
          addTrackedRejection(next, reversal)
          break
        }
        if (insertedRunIds.has(slot.runId)) {
          delete next.drafts[slot.runId]
          break
        }
        const pre =
          snapshot.drafts[slot.runId] ?? runText(baseline.fromModel, slot.runId)
        const post =
          baseline.sent.drafts[slot.runId] ??
          runText(baseline.fromModel, slot.runId)
        if (pre === undefined || pre === post) {
          delete next.drafts[slot.runId]
          break
        }
        delete next.drafts[slot.runId]
        for (const [targetRunId, text] of reversalRunTexts(
          identities,
          slot.runId,
          pre,
        )) {
          next.drafts[targetRunId] = text
        }
        break
      }
      case 'paragraph-style': {
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          delete next.format.paragraphStyles[slot.paragraphId]
          addTrackedRejection(next, reversal)
          break
        }
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        const pre =
          snapshot.format.paragraphStyles[slot.paragraphId] ??
          storyParagraph(baseline.fromModel, slot.paragraphId)?.styleId
        const post =
          baseline.sent.format.paragraphStyles[slot.paragraphId] ??
          storyParagraph(baseline.fromModel, slot.paragraphId)?.styleId
        if (pre === undefined || pre === post) {
          delete next.format.paragraphStyles[slot.paragraphId]
          break
        }
        if (
          baseline.toModel &&
          storyParagraph(baseline.toModel, targetParagraphId) === undefined
        ) {
          delete next.format.paragraphStyles[slot.paragraphId]
          break
        }
        delete next.format.paragraphStyles[slot.paragraphId]
        next.format.paragraphStyles[targetParagraphId] = pre
        break
      }
      case 'insert': {
        const reversal = identities.insertReversals.get(slot.clientId)
        if (reversal) {
          next.inserts =
            removeInsert(next.inserts, slot.clientId)?.inserts ?? next.inserts
          addTrackedRejection(next, reversal.ooxmlIds, [
            reversal.removeParagraphId,
          ])
          break
        }
        const insert = snapshot.inserts.find(
          (item) => item.clientId === slot.clientId,
        )
        if (insert) {
          const preText = insertPlainText(insert)
          const saved = baseline.sent.inserts.find(
            (item) => item.clientId === slot.clientId,
          )
          const savedText = saved ? insertPlainText(saved) : ''
          next.inserts =
            removeInsert(next.inserts, slot.clientId)?.inserts ?? next.inserts
          if (preText !== savedText) {
            next.drafts[
              identities.insertedRuns.get(slot.clientId) ??
                pendingRunId(slot.clientId)
            ] = preText
          }
        } else {
          next.deletedParagraphIds.push(
            identities.inserted.get(slot.clientId) ??
              pendingDeleteId(slot.clientId),
          )
        }
        break
      }
      case 'delete': {
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (
          reversal &&
          !snapshot.deletedParagraphIds.includes(slot.paragraphId)
        ) {
          addTrackedRejection(next, reversal)
          break
        }
        if (snapshot.deletedParagraphIds.includes(slot.paragraphId)) {
          next.deletedParagraphIds = next.deletedParagraphIds.filter(
            (id) => id !== slot.paragraphId,
          )
          break
        }
        const anchor = identities.restoredAnchors.get(slot.paragraphId)
        const beforeAnchor = identities.restoredBeforeAnchors.get(
          slot.paragraphId,
        )
        const restored = restoreInsert(
          baseline,
          slot.paragraphId,
          anchor,
          beforeAnchor,
        )
        if (!restored) return null
        next.inserts.push(restored)
        const style = storyParagraph(
          baseline.fromModel,
          slot.paragraphId,
        )?.styleId
        if (style) next.format.paragraphStyles[restored.clientId] = style
        break
      }
      case 'emphasis': {
        const sent = baseline.sent.format.emphasis.find(
          (item) => emphasisSlotKey(item) === slot.key,
        )
        Object.assign(next, removeDraftSlots(next, [slot]))
        if (!sent) break
        const sentReversal =
          (sent.runId ? identities.runReversals.get(sent.runId) : undefined) ??
          (sent.paragraphId
            ? identities.paragraphReversals.get(sent.paragraphId)
            : undefined)
        if (sentReversal) {
          addTrackedRejection(next, sentReversal)
          break
        }
        const inverse = sent.runId
          ? preEmphasisForRun(baseline.fromModel, sent.runId)
          : sent.paragraphId !== undefined &&
              sent.from !== undefined &&
              sent.to !== undefined
            ? preEmphasisForRange(
                baseline.fromModel,
                sent.paragraphId,
                sent.from,
                sent.to,
              )
            : null
        if (!inverse) break
        if (sent.runId) {
          const continuations =
            identities.runContinuations.get(sent.runId) ?? []
          const runIds =
            continuations.length === 0
              ? [pendingUnresolvedRunId(sent.runId)]
              : continuations.map(
                  (continuation) =>
                    continuation.runId ??
                    pendingRunAddressId(continuation.address),
                )
          for (const runId of runIds) {
            next.format.emphasis = mergeEmphasis(next.format.emphasis, {
              runId,
              ...inverse,
            })
          }
        } else {
          next.format.emphasis = mergeEmphasis(next.format.emphasis, {
            paragraphId:
              identities.paragraphIds.get(sent.paragraphId ?? '') ??
              sent.paragraphId,
            from: sent.from,
            to: sent.to,
            ...inverse,
          })
        }
        break
      }
      case 'numbering': {
        Object.assign(next, removeDraftSlots(next, [slot]))
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        if (!paragraph) break
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        next.format.numbering[targetParagraphId] = paragraphNumPr(
          paragraph,
          baseline.fromModel.styles,
        ) ?? { numId: null }
        break
      }
      case 'paragraph-format': {
        Object.assign(next, removeDraftSlots(next, [slot]))
        const reversal = identities.paragraphReversals.get(slot.paragraphId)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        const sent = baseline.sent.format.paragraphFormats[slot.paragraphId]
        if (!paragraph || !sent) break
        const before = paragraphFormatOf(paragraph)
        const pending = snapshot.format.paragraphFormats[slot.paragraphId]
        const inverse = reversalParagraphFormat(pending, before, sent)
        const saved = reversalParagraphFormat(sent, before, sent)
        if (sameParagraphFormat(inverse, saved)) break
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        if (
          baseline.toModel &&
          storyParagraph(baseline.toModel, targetParagraphId) === undefined
        ) {
          break
        }
        next.format.paragraphFormats[targetParagraphId] = inverse
        break
      }
      case 'extra-runs': {
        const paragraph = storyParagraph(baseline.fromModel, slot.paragraphId)
        const lastOriginal = paragraph?.runs.at(-1)
        Object.assign(next, removeDraftSlots(next, [slot]))
        if (!lastOriginal) break
        const reversal = identities.runReversals.get(lastOriginal.id)
        if (reversal) {
          addTrackedRejection(next, reversal)
          break
        }
        const pre =
          snapshot.drafts[lastOriginal.id] ??
          runText(baseline.fromModel, lastOriginal.id)
        if (pre !== undefined) {
          for (const [targetRunId, text] of reversalRunTexts(
            identities,
            lastOriginal.id,
            pre,
          )) {
            next.drafts[targetRunId] = text
          }
        }
        break
      }
      case 'section': {
        Object.assign(next, removeDraftSlots(next, [slot]))
        const sent = baseline.sent.format.section
        const inverse = sectionReversal(baseline.fromModel, sent)
        if (inverse) next.format.section = inverse
        break
      }
      case 'break': {
        Object.assign(next, removeDraftSlots(next, [slot]))
        break
      }
      case 'structure': {
        if (snapshot.structures.some((item) => item.id === slot.id)) {
          Object.assign(next, removeDraftSlots(next, [slot]))
          break
        }
        if (!STRUCTURE_KIND_REMOVABLE[slot.structureKind]) break
        return null
      }
      default: {
        Object.assign(next, removeDraftSlots(next, [slot]))
      }
    }
  }
  return next
}
