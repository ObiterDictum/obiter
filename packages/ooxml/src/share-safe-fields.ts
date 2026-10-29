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

const SHARE_SAFE_REMOVE_FIELDS = new Set(['SET', 'FILENAME'])

export const FIELD_REFERENCE_NAMES = new Set([
  'GOTOBUTTON',
  'NOTEREF',
  'PAGEREF',
  'REF',
])

export const SHARE_SAFE_MAX_FIELD_NESTING = 32

export function isFormulaFieldInstruction(instruction: string) {
  return instruction.trimStart().startsWith('=')
}

export interface FieldSpan {
  instruction: string
  dropped: XmlElement[]
  whole: XmlElement[]
  instrText: XmlElement[]
  end: XmlElement | undefined
  simple: XmlElement | undefined
}

export type FieldClass = 'keep' | 'remove' | 'flatten' | 'refuse'

export function classifyFieldInstruction(instruction: string): FieldClass {
  if (isFormulaFieldInstruction(instruction)) return 'keep'
  const name = fieldInstructionName(instruction)
  if (name === '') return 'flatten'
  if (SHARE_SAFE_FIELD_NAMES.has(name)) return 'keep'
  return SHARE_SAFE_REMOVE_FIELDS.has(name) ? 'remove' : 'refuse'
}

export interface FieldAnalysis {
  spans: FieldSpan[]
  orphanMarkers: XmlElement[]
  refused: boolean
  depthExceeded: boolean
}

export function analyseFieldSpans(
  source: string,
  elements: readonly XmlElement[],
  xmlInnerText: (start: number, end: number) => string,
  gone: (element: XmlElement) => boolean,
): FieldAnalysis {
  interface Frame {
    begin: XmlElement
    beginIndex: number
    instr: XmlElement[]
    instruction: string
    separates: XmlElement[]
    end: XmlElement | undefined
  }
  const frames: Frame[] = []
  const spans: FieldSpan[] = []
  const orphanMarkers: XmlElement[] = []
  let refused = false

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    if (gone(element)) continue
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
        if (frames.length >= SHARE_SAFE_MAX_FIELD_NESTING) {
          return {
            spans: [],
            orphanMarkers: [],
            refused: false,
            depthExceeded: true,
          }
        }
        frames.push({
          begin: element,
          beginIndex: index,
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
        spans.push(assemble(top, index))
      } else {
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

  for (const frame of frames) {
    if (classifyFieldInstruction(frame.instruction) !== 'keep') {
      refused = true
      continue
    }
    orphanMarkers.push(frame.begin, ...frame.instr, ...frame.separates)
  }

  return { spans, orphanMarkers, refused, depthExceeded: false }

  function assemble(frame: Frame, endIndex: number): FieldSpan {
    const end = elements[endIndex]
    const boundary =
      frame.separates.length > 0
        ? frame.separates[frame.separates.length - 1]
        : end
    const whole = elements
      .slice(frame.beginIndex, endIndex + 1)
      .filter((element) => element.end <= end.end)
    const dropped = whole.filter(
      (element) => element.end <= boundary.end || element === end,
    )
    return {
      instruction: frame.instruction,
      dropped,
      whole,
      instrText: frame.instr,
      end,
      simple: undefined,
    }
  }
}

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
  if (!sawOperand) return 'flatten'
  const rewritten = rebuilt.join(' ')
  return rewritten === instruction ? undefined : rewritten
}
