import type { DocumentEditOperation } from '@obiter/contracts'

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
    return !changes.paragraphIds.has(operation.paragraphId)
  }
  if (operation.type === 'insert_image') {
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
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (operation.type === 'insert_cross_reference') {
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
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId) ||
      changes.paragraphRunChanges.has(operation.paragraphId)
    )
  }
  if (operation.type === 'insert_table_of_contents') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphStyles.size > 0 ||
      changes.paragraphOpaque.size > 0 ||
      changes.paragraphRunChanges.size > 0
    )
  }
  if (operation.type === 'insert_table_of_authorities') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphStyles.size > 0 ||
      changes.paragraphOpaque.size > 0 ||
      changes.paragraphRunChanges.size > 0
    )
  }
  if (operation.type === 'update_table_of_authorities') {
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
