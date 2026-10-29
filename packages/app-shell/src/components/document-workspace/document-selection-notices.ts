import type { DocumentRangeRefusal } from '../../document-range-edits'

const INSERT_BLOCKS_SELECTION =
  'Selection cannot cross an unsaved inserted paragraph. Save or discard it first.'

const STRUCTURE_BLOCKS_SELECTION =
  'Selection cannot cross a table or text box. Select the body text on either side instead.'

const JOIN_FORMATTING_BLOCKS_EDIT =
  'This edit would drop formatting the document cannot save. Change the text on each side instead.'

export const TRACKED_CHANGE_BLOCKS_JOIN =
  'This paragraph holds tracked changes. Accept or reject them before joining paragraphs.'

const INPUT_BLOCKS_EDIT =
  'That input cannot replace a document selection. Edit the text on each side instead.'

const FIND_REPLACE_BLOCKS_STRUCTURE =
  'That match cannot be replaced because it crosses a table, a text box, or a stored field boundary.'

const FIND_REPLACE_EMPTY = 'That match is no longer in the document.'

const CLIPBOARD_BLOCKS_CUT =
  'The clipboard could not be written, so the text was not deleted.'

const CLIPBOARD_BLOCKS_COPY =
  'The clipboard could not be written, so nothing was copied.'

const CLIPBOARD_BLOCKS_PASTE = 'The clipboard could not be read.'

export type SelectionRefusal =
  | 'insert'
  | 'structure'
  | 'join-formatting'
  | 'find-structure'
  | 'find-empty'
  | 'input'
  | 'clipboard'
  | 'clipboard-copy'
  | 'clipboard-read'
  | DocumentRangeRefusal

const REFUSAL_MESSAGES = {
  'join-formatting': JOIN_FORMATTING_BLOCKS_EDIT,
  'tracked-change': TRACKED_CHANGE_BLOCKS_JOIN,
  'find-structure': FIND_REPLACE_BLOCKS_STRUCTURE,
  'find-empty': FIND_REPLACE_EMPTY,
  input: INPUT_BLOCKS_EDIT,
  clipboard: CLIPBOARD_BLOCKS_CUT,
  'clipboard-copy': CLIPBOARD_BLOCKS_COPY,
  'clipboard-read': CLIPBOARD_BLOCKS_PASTE,
} satisfies Partial<Record<SelectionRefusal, string>>

export function refusalMessage(
  refusal: SelectionRefusal | null,
  hasInsert: boolean,
  hasStructure: boolean,
): string | null {
  if (refusal === 'insert') {
    return hasInsert ? INSERT_BLOCKS_SELECTION : null
  }
  if (refusal === 'structure') {
    return hasStructure ? STRUCTURE_BLOCKS_SELECTION : null
  }
  return (refusal && REFUSAL_MESSAGES[refusal]) || null
}
