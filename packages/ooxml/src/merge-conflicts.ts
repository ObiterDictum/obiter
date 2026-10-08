import type { DocumentEditOperation } from '@obiter/contracts'

/**
 * The footprint of what changed between the base and current versions of a
 * merge candidate, and which client operations those changes conflict with.
 * Kept apart from `collaboration-merge.ts`, which is at its source ceiling
 * carrying the alignment machinery.
 */
export type ChangedFootprints = {
  paragraphStyles: ReadonlySet<string>
  paragraphOpaque: ReadonlySet<string>
  paragraphRunChanges: ReadonlySet<string>
  runText: ReadonlySet<string>
  runStyles: ReadonlySet<string>
  runOpaque: ReadonlySet<string>
  paragraphIds: ReadonlySet<string>
  runIds: ReadonlySet<string>
}

export function operationConflicts(
  operation: DocumentEditOperation,
  changes: ChangedFootprints,
) {
  if (
    operation.type === 'insert_paragraph_after' ||
    operation.type === 'insert_paragraph_before'
  ) {
    return !changes.paragraphIds.has(operation.paragraphId)
  }
  if (operation.type === 'insert_table') {
    // The table is spliced directly after its anchor, so it needs the anchor
    // to survive into the current version — the same footprint an inserted
    // paragraph requires. The anchor's own content is untouched.
    return !changes.paragraphIds.has(operation.paragraphId)
  }
  if (operation.type === 'insert_image') {
    // The offset addresses this paragraph's text, so a text edit to the same
    // paragraph in the current version moves the picture; refuse rather than
    // place it at a stale offset, as for a break.
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (
    operation.type === 'set_hyperlink' ||
    operation.type === 'mark_defined_term'
  ) {
    // A range mark addresses this paragraph's text, so a text edit to the
    // same paragraph in the current version moves the covered range; refuse
    // rather than wrap the wrong runs.
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (operation.type === 'insert_cross_reference') {
    // The offset addresses this paragraph's text, and the target must survive
    // to carry the bookmark — both footprints apply.
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      !changes.paragraphIds.has(operation.targetParagraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (operation.type === 'delete_paragraph') return true
  if (operation.type === 'set_paragraph_style') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphStyles.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (operation.type === 'set_paragraph_numbering') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (operation.type === 'set_paragraph_format') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (
    operation.type === 'insert_break' ||
    operation.type === 'insert_page_number' ||
    operation.type === 'insert_footnote'
  ) {
    // The offset addresses this paragraph's text, so a text edit to the same
    // paragraph in the current version moves the splice; refuse rather than
    // place it at a stale offset.
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (operation.type === 'insert_table_of_contents') {
    // The offset footprint is shared with the other splices, but the entries
    // also bookmark every heading paragraph — a deleted or rewritten heading
    // anywhere in the document changes what the field captures. The
    // footprint cannot say which changed ids are headings, so any paragraph
    // change conflicts rather than capture a stale entry list.
    // `paragraphIds` is the presence set: every aligned paragraph, changed
    // or not. It answers only whether the anchor survived; the change sets
    // are `paragraphStyles`, `paragraphOpaque` and `paragraphRunChanges`.
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphStyles.size > 0 ||
      changes.paragraphOpaque.size > 0 ||
      changes.paragraphRunChanges.size > 0
    )
  }
  if (operation.type === 'insert_section_break') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  // A section-properties edit is document-wide and carries no paragraph or run
  // address, so it has no footprint to conflict with in E5.
  if (operation.type === 'set_section_properties') return false
  if (operation.type === 'set_run_emphasis') {
    if (operation.runId !== undefined) {
      return (
        !changes.runIds.has(operation.runId) ||
        changes.runOpaque.has(operation.runId) ||
        changes.runStyles.has(operation.runId)
      )
    }
    if (operation.paragraphId === undefined) return true
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (!changes.runIds.has(operation.runId)) return true
  if (changes.runOpaque.has(operation.runId)) return true
  return operation.type === 'replace_run_text'
    ? changes.runText.has(operation.runId)
    : changes.runStyles.has(operation.runId)
}
