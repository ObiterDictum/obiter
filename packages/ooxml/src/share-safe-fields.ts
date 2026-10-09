import {
  attributeValue,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
import {
  fieldInstructionName,
  fieldInstructionTokens,
  fieldInstructionTokenValue,
} from './field-instructions'

/**
 * Field instructions the copy may carry intact: every name here is bounded
 * to document content — computed values, in-document references, index/
 * TOC/TA marking, form fields and the `=` formula. `SHARE_SAFE_REMOVE_
 * FIELDS` drop whole (instruction and cached result) because the stored
 * value is itself a metadata channel; every other name — fetchers, merge
 * fields, bibliography controls and names this build does not know —
 * refuses the copy: a fetcher's cached result is externally-sourced text
 * that cannot be attributed to this document.
 */
export const SHARE_SAFE_FIELD_NAMES = new Set([
  'ADVANCE',
  'AUTONUM',
  'AUTONUMLGL',
  'AUTONUMOUT',
  'CREATEDATE',
  'DATE',
  'EDITTIME',
  'EQ',
  'FORMCHECKBOX',
  'FORMDROPDOWN',
  'FORMTEXT',
  'GOTOBUTTON',
  'IF',
  'INDEX',
  'LISTNUM',
  'NOTEREF',
  'NUMCHARS',
  'NUMPAGES',
  'NUMWORDS',
  'PAGE',
  'PAGEREF',
  'PRINTDATE',
  'QUOTE',
  'REF',
  'SAVEDATE',
  'SECTION',
  'SECTIONPAGES',
  'SEQ',
  'STYLEREF',
  'SYMBOL',
  'TA',
  'TC',
  'TIME',
  'TOA',
  'TOC',
  'XE',
])

/**
 * Fields removed whole — instruction, markers and cached result — because
 * what they store is the private channel and their displayed result is
 * nothing a reader misses: `SET` is an invisible datastore write and
 * `FILENAME` displays only the author's own path. The document-variable,
 * property and identity fields (`DOCVARIABLE`, `DOCPROPERTY`, `INFO`,
 * `AUTHOR`, `PRIVATE`, …) instead refuse: their cached result renders
 * private data as if it were document content.
 */
export const SHARE_SAFE_REMOVE_FIELDS = new Set(['SET', 'FILENAME'])

/**
 * Field names whose operands are in-document references — `REF`,
 * `PAGEREF`, `NOTEREF` and `GOTOBUTTON` name bookmarks, so their operands
 * follow the generated `bm<n>` renaming and must resolve to a shipped
 * bookmark. Every other field's tokens are content: a `TC "Figure"` that
 * happens to collide with a bookmark's name is a coincidence, never a
 * reference, and must ship untouched.
 */
export const FIELD_REFERENCE_NAMES = new Set([
  'GOTOBUTTON',
  'NOTEREF',
  'PAGEREF',
  'REF',
])

/** The `=` formula field is written as `{ =… }` with no field name. */
export function isFormulaFieldInstruction(instruction: string) {
  return instruction.trimStart().startsWith('=')
}

/**
 * Field-structure analysis for a kept part. Field machinery is spans, not
 * elements — a `w:fldChar begin` … `separate` … `end` sequence carries its
 * instruction in `w:instrText` runs between begin and the last `separate`,
 * and `w:fldSimple` carries it on `w:instr`. This pass reconstructs each
 * span, classifies it by instruction name, and names which elements the
 * transform drops: `SET`, `FILENAME` and the identity/datastore fields
 * remove whole; unknown, external and merge fields flatten to their
 * displayed result; only the bounded keep set ships instruction text.
 *
 * Spans this pass cannot close or classify refuse through
 * `analyseFieldSpans`'s `refused` flag rather than shipping half.
 */

export interface FieldSpan {
  /** The instruction text, concatenated across `w:instrText` runs. */
  instruction: string
  /** Elements the transform drops: [begin, lastSeparate) plus `end`. */
  dropped: XmlElement[]
  /** Elements the transform drops for a remove-whole field. */
  whole: XmlElement[]
  /** `w:instrText` elements of the kept span, in document order. */
  instrText: XmlElement[]
  /** The `w:fldChar end` element, absent when the span never closed. */
  end: XmlElement | undefined
  /** `w:fldSimple` element when the field is simple rather than complex. */
  simple: XmlElement | undefined
}

export type FieldClass = 'keep' | 'remove' | 'flatten' | 'refuse'

export function classifyFieldInstruction(instruction: string): FieldClass {
  if (isFormulaFieldInstruction(instruction)) return 'keep'
  const name = fieldInstructionName(instruction)
  // An instruction with no readable name — empty, or leading with a
  // switch or a quote — carries arbitrary text under no contract: the
  // field flattens to its cached result rather than shipping it.
  if (name === '') return 'flatten'
  if (SHARE_SAFE_FIELD_NAMES.has(name)) return 'keep'
  return SHARE_SAFE_REMOVE_FIELDS.has(name) ? 'remove' : 'refuse'
}

export interface FieldAnalysis {
  /** Closed spans, in document order. */
  spans: FieldSpan[]
  /**
   * `w:instrText`/`w:fldChar` elements outside any field span — orphans
   * with nothing to attach to. The transform removes them; an unclosed
   * span's instruction is folded into its own handling instead.
   */
  orphanMarkers: XmlElement[]
  /** A field the analysis could not bound — the copy refuses. */
  refused: boolean
}

/**
 * Walk a part's elements in order, reconstructing field spans. `gone`
 * reports elements inside subtrees the element pass already removed — they
 * no longer take part in span structure.
 */
export function analyseFieldSpans(
  source: string,
  elements: readonly XmlElement[],
  xmlInnerText: (start: number, end: number) => string,
  gone: (element: XmlElement) => boolean,
): FieldAnalysis {
  interface Frame {
    begin: XmlElement
    instr: XmlElement[]
    instruction: string
    separates: XmlElement[]
    end: XmlElement | undefined
  }
  const frames: Frame[] = []
  const spans: FieldSpan[] = []
  const orphanMarkers: XmlElement[] = []
  let refused = false

  for (const element of elements) {
    if (gone(element)) continue
    // Only w: field machinery is spanned; a:fld inside a shape's txBody
    // carries no instruction text this pass owns.
    if (element.namespaceUri !== WORD_NAMESPACE) continue

    if (element.localName === 'instrText') {
      const top = frames[frames.length - 1]
      if (top === undefined || top.separates.length > 0) {
        orphanMarkers.push(element)
        continue
      }
      top.instr.push(element)
      top.instruction += xmlInnerText(
        element.startTagEnd,
        element.endTagStart ?? element.startTagEnd,
      )
      continue
    }
    if (element.localName === 'fldChar') {
      const type = attributeValue(element, element.namespaceUri, 'fldCharType')
      if (type === 'begin') {
        frames.push({
          begin: element,
          instr: [],
          instruction: '',
          separates: [],
          end: undefined,
        })
        continue
      }
      const top = frames[frames.length - 1]
      if (top === undefined) {
        orphanMarkers.push(element)
        continue
      }
      if (type === 'separate') {
        top.separates.push(element)
      } else if (type === 'end') {
        frames.pop()
        top.end = element
        spans.push(assemble(top))
      } else {
        // Unknown marker type — refuse rather than guess its shape.
        refused = true
      }
      continue
    }
    if (element.localName === 'fldSimple') {
      const instruction =
        attributeValue(element, element.namespaceUri, 'instr') ?? ''
      spans.push({
        instruction,
        dropped: [],
        whole: [element],
        instrText: [],
        end: undefined,
        simple: element,
      })
      continue
    }
  }

  // Frames still open when the walk ends are unclosed spans: a field the
  // part never terminates cannot be flattened or removed to a bounded
  // range — the copy refuses unless it is a keep-class instruction. A
  // keep-class frame that never closed ships none of its machinery — its
  // begin marker, instruction runs and separators are orphans — so an
  // instruction cannot leak out of a half-parsed field.
  for (const frame of frames) {
    if (classifyFieldInstruction(frame.instruction) !== 'keep') {
      refused = true
      continue
    }
    orphanMarkers.push(frame.begin, ...frame.instr, ...frame.separates)
  }

  return { spans, orphanMarkers, refused }

  function assemble(frame: Frame): FieldSpan {
    // Flattening drops [begin, lastSeparate-or-endStart) plus the end
    // marker; removing drops the whole [begin, end] span including the
    // cached result.
    const boundary =
      frame.separates.length > 0
        ? frame.separates[frame.separates.length - 1]
        : frame.end
    const dropped: XmlElement[] = []
    const whole: XmlElement[] = []
    for (const element of elements) {
      const inside =
        element.start >= frame.begin.start &&
        frame.end !== undefined &&
        element.end <= frame.end.end
      if (inside) whole.push(element)
      if (
        inside &&
        boundary !== undefined &&
        (element.end <= boundary.end || element === frame.end)
      ) {
        dropped.push(element)
      }
    }
    return {
      instruction: frame.instruction,
      dropped,
      whole,
      instrText: frame.instr,
      end: frame.end,
      simple: undefined,
    }
  }
}

/**
 * Rewrites a reference field's bookmark operands to the generated names
 * the anchors ship under. Every non-switch token after the field name is
 * an operand — one naming no shipped bookmark is a dangling pointer to a
 * name the copy never emits, so the instruction returns `'flatten'` and
 * the field keeps only its displayed result. `undefined` means the
 * instruction already reads canonically; a string is the rewritten form.
 */
export function rewriteReferenceInstruction(
  instruction: string,
  renames: ReadonlyMap<string, string>,
): string | 'flatten' | undefined {
  const tokens = fieldInstructionTokens(instruction)
  let sawOperand = false
  const rebuilt: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (index === 0 || token.startsWith('\\')) {
      rebuilt.push(token)
      continue
    }
    sawOperand = true
    const renamed = renames.get(fieldInstructionTokenValue(token))
    if (renamed === undefined) return 'flatten'
    rebuilt.push(renamed)
  }
  // A reference field that names no operand points at nothing.
  if (!sawOperand) return 'flatten'
  const rewritten = rebuilt.join(' ')
  return rewritten === instruction ? undefined : rewritten
}
