import type { DocumentRangeRefusal } from '../../document-range-edits'

/** The message shown when an unsaved inserted paragraph blocks a selection. */
export const INSERT_BLOCKS_SELECTION =
  'Selection cannot cross an unsaved inserted paragraph. Save or discard it first.'

/**
 * The message shown when a selection would cross a table or a text box. The
 * selection model only covers paragraphs the flow renders as ordinary body
 * text, so a table is a barrier rather than silently bridged content.
 */
export const STRUCTURE_BLOCKS_SELECTION =
  'Selection cannot cross a table or text box. Select the body text on either side instead.'

/**
 * The message shown when a range edit would join a tail whose formatting the
 * save cannot restate. Refusing before the draft changes keeps what the editor
 * paints and what the saved document holds the same.
 */
export const JOIN_FORMATTING_BLOCKS_EDIT =
  'This edit would drop formatting the document cannot save. Change the text on each side instead.'

/** The message shown when input that must replace a document selection cannot
 * be expressed as such, instead of the input silently disappearing. */
export const INPUT_BLOCKS_EDIT =
  'That input cannot replace a document selection. Edit the text on each side instead.'

/** The message shown when a cut could not write the clipboard, so the text was
 * left in the document rather than deleted for a copy that never happened. */
export const CLIPBOARD_BLOCKS_CUT =
  'The clipboard could not be written, so the text was not deleted.'

/** Why the last selection action was refused. The message is derived from the
 * kind, so a refusal cannot outlive the condition that produced it. */
export type SelectionRefusal =
  | 'insert'
  | 'structure'
  | 'join-formatting'
  | 'input'
  | 'clipboard'
  | DocumentRangeRefusal

export function refusalMessage(
  refusal: SelectionRefusal | null,
  hasInsert: boolean,
  hasStructure: boolean,
): string | null {
  switch (refusal) {
    case 'insert':
      return hasInsert ? INSERT_BLOCKS_SELECTION : null
    case 'structure':
      return hasStructure ? STRUCTURE_BLOCKS_SELECTION : null
    case 'join-formatting':
      return JOIN_FORMATTING_BLOCKS_EDIT
    case 'input':
      return INPUT_BLOCKS_EDIT
    case 'clipboard':
      return CLIPBOARD_BLOCKS_CUT
    default:
      return null
  }
}
