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

/**
 * Whether the edit vocabulary can remove a saved structure of this kind.
 * `insert_table`, `insert_image`, `insert_cross_reference`,
 * `insert_page_number` and `insert_footnote` have no inverse, so the stored
 * structure is baseline content the moment it is saved: a history snapshot
 * that predates it stays consistent, and undo simply cannot offer its
 * removal. `set_hyperlink` alone removes — a null target unwraps a stored
 * link — so a predating snapshot is a reversal this path does not
 * synthesise, and it keeps the explicit block. The map is exhaustive on
 * `StructureKind` so adding a kind fails to compile until this decision is
 * made for it.
 */
const STRUCTURE_KIND_REMOVABLE = {
  table: false,
  image: false,
  link: true,
  'cross-reference': false,
  'page-number': false,
  footnote: false,
  // `insert_table_of_contents` has no inverse either: the generated entry
  // paragraphs and their bookmarks are baseline content once saved, and the
  // edit vocabulary has no remove-field operation to reverse them with.
  'table-of-contents': false,
  // `insert_table_of_authorities` shares the same answer: the `TA` marks,
  // `_ToA` bookmarks and generated entry paragraphs are baseline content
  // once saved, with no unmark or remove-field operation to reverse them.
  'table-of-authorities': false,
  // `update_table_of_authorities` likewise: the rewritten range, marks and
  // bookmarks are baseline content once saved, and a field update cannot
  // restore the result it replaced.
  'table-of-authorities-refresh': false,
  // `mark_defined_term` likewise: the bookmark pair is baseline content once
  // saved and there is no unmark operation in the vocabulary.
  'defined-term': false,
} satisfies Record<StructureKind, boolean>

/**
 * Re-expresses one history snapshot against the saved baseline. Returns null
 * when the snapshot cannot be represented at all (a saved delete that removed
 * the only paragraph its restoration could anchor to), so the caller drops it
 * rather than replaying it.
 */
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
        // A tracked replacement's run is absent from the reparsed model, so
        // its reversal is the rejection group the lineage carries, never a run
        // id for content the model does not have.
        const reversal = identities.runReversals.get(slot.runId)
        if (reversal) {
          delete next.drafts[slot.runId]
          addTrackedRejection(next, reversal)
          break
        }
        // A run on a paragraph the same save inserted is removed with that
        // paragraph's deletion; it is not separately addressable.
        if (insertedRunIds.has(slot.runId)) {
          delete next.drafts[slot.runId]
          break
        }
        // Never fall back to the base run id: it names unrelated content once
        // a save shifts run positions. The lineage's continuing runs are the
        // only reason a reversal can be addressed before the model reloads.
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
        // A tracked paragraph insertion is one atomic edit: its content lives
        // inside `w:ins`, so no intermediate snapshot of it (an empty shell,
        // or a later edit within it) is separately representable. Every
        // snapshot of the insertion collapses to the same reversal: reject the
        // change and remove the shell, in one decision.
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
          // The snapshot held the insert, so it describes the paragraph the
          // save stored. Its text becomes an override on that stored paragraph
          // instead of a fresh insertion.
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
          // The snapshot predates the insert, so it describes the document
          // without the paragraph the save stored. That is a deletion of the
          // stored paragraph; a tracked insertion took the reversal branch
          // above and never reaches here.
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
          // A tracked deletion leaves the paragraph in the model with its runs
          // hidden. Its reversal is the rejection group, not a restored copy.
          addTrackedRejection(next, reversal)
          break
        }
        if (snapshot.deletedParagraphIds.includes(slot.paragraphId)) {
          // The save stored the deletion, so the mask is the baseline.
          next.deletedParagraphIds = next.deletedParagraphIds.filter(
            (id) => id !== slot.paragraphId,
          )
          break
        }
        // The snapshot predates the deletion: reverse it by re-inserting the
        // paragraph the save removed, after its nearest surviving neighbour or,
        // for a deleted first paragraph, before the first survivor.
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
        // The paragraph style rides on the insert so a restored paragraph keeps
        // it, exactly as collectEditOperations folds a pending insert's style.
        const style = storyParagraph(
          baseline.fromModel,
          slot.paragraphId,
        )?.styleId
        if (style) next.format.paragraphStyles[restored.clientId] = style
        break
      }
      case 'emphasis': {
        // Reverse the saved formatting by restating the pre-save properties at
        // the result address, instead of merely dropping the slot (which left
        // the saved formatting in place).
        //
        // Known limitation, shared with `numbering`: the inverse reads only the
        // stored pre-save model, never the snapshot's own pending emphasis, so
        // a property the snapshot held pending is not consulted. Paragraph
        // format (below) is E3 scope; the fix here would be the same pattern.
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
        // A mid-run splice fanned the run out to several result runs, each
        // inheriting the saved character properties, so the inverse is
        // restated on every one — or the tail keeps the saved formatting.
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
        // Reverse a saved numbering change by restating the pre-save numbering
        // at the result paragraph, rather than merely dropping the slot. A
        // `w:pPr` holding tracked history never reaches the model's preserved
        // fragments (see paragraphFormatOf), so a pre-save numbering inside one
        // is not visible here: the same wire-model blind spot, recorded in the
        // Known divergences table.
        //
        // Known limitation, shared with `emphasis`: the inverse reads only the
        // stored pre-save model, never the snapshot's own pending numbering, so
        // a snapshot that held one is not consulted.
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
        // Reverse a saved paragraph-layout change by restating the pre-save
        // answer at the result paragraph. The snapshot's own pending layout is
        // that pre-save answer; the stored paragraph is only the fallback for a
        // snapshot recorded before the pending edit. A family the save wrote
        // that neither carried is released with an explicit null, so undo
        // clears it rather than leaving the saved value.
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
        // The sibling convention: when what the reversal restores is exactly
        // what the save stored, there is nothing to change and the slot drops.
        const inverse = reversalParagraphFormat(pending, before, sent)
        const saved = reversalParagraphFormat(sent, before, sent)
        if (sameParagraphFormat(inverse, saved)) break
        const targetParagraphId =
          identities.paragraphIds.get(slot.paragraphId) ?? slot.paragraphId
        // Mirror the paragraph-style branch: the same batch deleted this
        // paragraph from the saved model, so there is no result paragraph to
        // hold the reversal. The slot was already dropped by removeDraftSlots;
        // writing the inverse anyway would leave a draft the next save can
        // never send and would block permanently.
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
        // A join folded the appended runs into the paragraph's last original
        // run. Restoring that run's pre-save text removes the appended content,
        // which is what undoing the join means.
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
        // A saved page-setup change is reversed by restating the pre-save
        // section over the same families the request wrote. The pre-save
        // answer is read from the stored model, never the snapshot's own
        // pending draft (the shared limitation of `emphasis` and `numbering`).
        Object.assign(next, removeDraftSlots(next, [slot]))
        const sent = baseline.sent.format.section
        const inverse = sectionReversal(baseline.fromModel, sent)
        if (inverse) next.format.section = inverse
        break
      }
      case 'break': {
        // There is no operation that removes a break, so the slot drops the
        // way a non-removable structure does: a snapshot holding the saved
        // break as pending work describes the document the save produced, so
        // the covered slot is forgotten and the rest of the snapshot — typed
        // drafts especially — survives translation; a snapshot that predates
        // the break keeps the stored break as baseline content undo cannot
        // offer to remove.
        Object.assign(next, removeDraftSlots(next, [slot]))
        break
      }
      case 'structure': {
        // A snapshot that still holds the saved structure as pending work
        // finds it on disk after the save: the covered slot drops and the
        // rest of the snapshot — unrelated typed drafts especially —
        // survives translation. A snapshot that predates the structure
        // describes the document without it, so restoring it would need a
        // removal; whether the vocabulary expresses one for this kind is
        // decided by STRUCTURE_KIND_REMOVABLE, not by a per-kind list.
        if (snapshot.structures.some((item) => item.id === slot.id)) {
          Object.assign(next, removeDraftSlots(next, [slot]))
          break
        }
        if (!STRUCTURE_KIND_REMOVABLE[slot.structureKind]) break
        return null
      }
      default: {
        // Any other slot (there is none the editor produces today): a snapshot
        // that still holds it loses it to the new baseline and never replays
        // it, and the reversal is not silently claimed as persisted.
        Object.assign(next, removeDraftSlots(next, [slot]))
      }
    }
  }
  return next
}

/**
 * The `set_section_properties` patch that restores the pre-save section for
 * each family the request wrote. `pageSize` alone restores both dimensions and
 * orientation, because the writer derives `w:orient` from an explicit size; a
 * missing pre-save size releases `w:pgSz` with an explicit null. Every margin
 * attribute is named, so a `w:pgMar` attribute the save added is released
 * instead of surviving its own reversal.
 */
