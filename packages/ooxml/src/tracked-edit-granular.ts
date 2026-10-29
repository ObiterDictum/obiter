import { normaliseEditText, planTextRevision } from '@obiter/contracts'
import type { TextRunAnchor } from './model'
import { wordRunInnerTextXml } from './text-run-edit'
import { decodeXmlReferences } from './xml-lexemes'
import { rawOffsetAtDecodedBoundary } from './text-offsets'

export type GranularRunEdit =
  | {
      kind: 'pieces'
      prefixRun?: string
      deletedRun?: string
      insertedRun?: string
      suffixRun?: string
    }
  | { kind: 'noop' }
  | { kind: 'fallback' }

export function granularRunEdit(
  source: string,
  anchor: TextRunAnchor,
  text: string,
  prefix: string,
  pendingProperties = false,
): GranularRunEdit {
  const middle = planTextRevision(
    anchor.wire.text,
    text,
    anchor.wire.textRevisionEligible === true,
    anchor.wire.textRevisionTokens,
    pendingProperties,
    anchor.wire.textRevisionTextRanges?.length,
  )
  if (middle.kind === 'noop') return { kind: 'noop' }
  if (middle.kind === 'whole-run') return { kind: 'fallback' }
  const { inserted } = middle
  const original = anchor.wire.text
  const start = sourceBoundary(original, middle.prefixLength)
  const end = sourceBoundary(
    original,
    normaliseEditText(original).length - middle.suffixLength,
  )
  const runClose = `</${prefix}:r>`
  const open = source.slice(anchor.runRange.start, anchor.runRange.startTagEnd)
  const properties = anchor.runPropertiesRange
  const rpr = properties ? source.slice(properties.start, properties.end) : ''
  const sourceRun = (from: number, to: number, name = 't') => {
    let cursor = 0
    let raw = ''
    for (const element of anchor.textElements) {
      const content = source.slice(element.startTagEnd, element.endTagStart)
      const length = decodeXmlReferences(content).length
      const left = Math.max(0, from - cursor)
      const right = Math.min(length, to - cursor)
      if (left < right)
        raw += content.slice(
          rawOffsetAtDecodedBoundary(content, left),
          rawOffsetAtDecodedBoundary(content, right),
        )
      cursor += length
    }
    const space = /^\s|\s$/u.test(decodeXmlReferences(raw))
      ? ' xml:space="preserve"'
      : ''
    return `${open}${rpr}<${prefix}:${name}${space}>${raw}</${prefix}:${name}>${runClose}`
  }
  const pieces: Extract<GranularRunEdit, { kind: 'pieces' }> = {
    kind: 'pieces',
  }
  if (start > 0) pieces.prefixRun = sourceRun(0, start)
  if (end < original.length) pieces.suffixRun = sourceRun(end, original.length)
  if (start < end) pieces.deletedRun = sourceRun(start, end, 'delText')
  if (inserted !== '') {
    pieces.insertedRun = `${open}${rpr}${wordRunInnerTextXml(prefix, inserted)}${runClose}`
  }
  return pieces
}

function sourceBoundary(source: string, offset: number) {
  let raw = 0
  for (let normalised = 0; normalised < offset; normalised += 1) {
    if (source[raw] === '\r' && source[raw + 1] === '\n') raw += 1
    raw += 1
  }
  return raw
}
