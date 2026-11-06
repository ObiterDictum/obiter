import { normaliseEditText } from '@obiter/contracts'
import { OoxmlError, type OoxmlDocument, type TextRunAnchor } from './model'
import {
  escapeXmlText,
  setOverlayReplacement,
  type OverlayReplacement,
} from './parts/overlay'
import { hasPendingBreakSplice } from './run-break-splices'

export function replaceTextRunAtAnchor(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  text: string,
) {
  const part = document.sourceParts.get(anchor.partName)
  const overlay = part?.overlay
  const span = runTextSpan(anchor)
  if (!part || !overlay || (!span && anchor.textRanges.length === 0))
    return false
  if (hasPendingBreakSplice(overlay, anchor.runRange)) {
    throw new OoxmlError('invalid-document-edit')
  }

  const replacements = runTextReplacements(overlay.source, anchor, text, 0)
  replacements.forEach((replacement, index) => {
    setOverlayReplacement(
      overlay,
      `${anchor.wire.id}:text:${index}`,
      replacement,
    )
  })
  const firstTextElement = anchor.textElements[0]
  if (!tabbedRunSpan(anchor, text) && firstTextElement) {
    const opening = overlay.source.slice(
      firstTextElement.start,
      firstTextElement.startTagEnd,
    )
    const preservedOpening = preserveTextElementXmlSpace(opening, text)
    if (preservedOpening !== opening) {
      setOverlayReplacement(overlay, `${anchor.wire.id}:xml-space`, {
        start: firstTextElement.start,
        end: firstTextElement.startTagEnd,
        value: preservedOpening,
      })
    }
  }
  anchor.wire.text = text
  part.dirty = true
  return true
}

function runPrefix(source: string, anchor: TextRunAnchor) {
  const opening = source.slice(
    anchor.runRange.start,
    anchor.runRange.startTagEnd,
  )
  return opening.match(/^<([^:>\s]+):/u)?.[1] ?? 'w'
}

function runTextSpan(anchor: TextRunAnchor) {
  const ranges = [
    ...anchor.textElements,
    ...anchor.textTabs,
    ...anchor.textBreaks,
  ]
  if (ranges.length === 0) return undefined
  const start = Math.min(...ranges.map((range) => range.start))
  const end = Math.max(...ranges.map((range) => range.end))
  return { start, end }
}

export function runTextReplacements(
  source: string,
  anchor: TextRunAnchor,
  text: string,
  origin: number,
): OverlayReplacement[] {
  const breakReplacements = lineBreakRunReplacements(
    anchor,
    text,
    source,
    origin,
  )
  if (breakReplacements)
    return [
      ...breakReplacements,
      ...textBreakReplacements(anchor, origin),
      ...tabReplacements(anchor, origin),
    ]
  const span = tabbedRunSpan(anchor, text)
  if (span)
    return [
      {
        start: span.start - origin,
        end: span.end - origin,
        value: wordRunInnerTextXml(runPrefix(source, anchor), text),
      },
    ]
  return [
    ...anchor.textRanges.map((range, index) => ({
      start: range.start - origin,
      end: range.end - origin,
      value: index === 0 ? escapeXmlText(text) : '',
    })),
    ...textBreakReplacements(anchor, origin),
  ]
}

export function tabbedRunSpan(anchor: TextRunAnchor, text: string) {
  if (/[\r\n]/u.test(text)) return undefined
  if (anchor.textTabs.length === 0 && !text.includes('\t')) return undefined
  return runTextSpan(anchor)
}

function tabReplacements(
  anchor: TextRunAnchor,
  origin: number,
): OverlayReplacement[] {
  return anchor.textTabs.map(({ start, end }) => ({
    start: start - origin,
    end: end - origin,
    value: '',
  }))
}

export function textBreakReplacements(
  anchor: TextRunAnchor,
  origin: number,
): OverlayReplacement[] {
  return anchor.textBreaks.map(({ start, end }) => ({
    start: start - origin,
    end: end - origin,
    value: '',
  }))
}

export function wordRunInnerTextXml(prefix: string, text: string) {
  return normaliseEditText(text)
    .split('\n')
    .map((line, index) => {
      const element = lineInnerXml(prefix, line)
      return index === 0 ? element : `<${prefix}:br/>${element}`
    })
    .join('')
}

export function lineBreakRunReplacements(
  anchor: TextRunAnchor,
  text: string,
  source: string,
  origin: number,
): OverlayReplacement[] | undefined {
  if (!/[\r\n]/u.test(text)) return undefined
  const elements = anchor.textElements
  const first = elements[0]
  if (!first) return undefined
  const opening = source.slice(first.start, first.startTagEnd)
  const prefix = opening.match(/^<([^:>\s]+):/u)?.[1] ?? 'w'
  const lines = normaliseEditText(text).split('\n')
  const assigned = Math.min(lines.length, elements.length)
  return elements.map((element, index) => {
    if (index >= assigned) {
      return {
        start: element.start - origin,
        end: element.end - origin,
        value: '',
      }
    }
    const line = lines[index] ?? ''
    const extra =
      index === assigned - 1 && lines.length > elements.length
        ? lines
            .slice(elements.length)
            .map((rest) => `<${prefix}:br/>${lineInnerXml(prefix, rest)}`)
            .join('')
        : index < lines.length - 1
          ? `<${prefix}:br/>`
          : ''
    return {
      start: element.start - origin,
      end: element.end - origin,
      value: `${lineInnerXml(prefix, line)}${extra}`,
    }
  })
}

function lineInnerXml(prefix: string, line: string) {
  return line
    .split('\t')
    .map((piece, index) => {
      const tab = index === 0 ? '' : `<${prefix}:tab/>`
      return `${tab}${piece ? textElementXml(prefix, piece) : ''}`
    })
    .join('')
}

function textElementXml(prefix: string, text: string) {
  return `<${prefix}:t${textElementXmlSpaceAttribute(text)}>${escapeXmlText(text)}</${prefix}:t>`
}

function textElementXmlSpaceAttribute(text: string) {
  return requiresPreservedXmlSpace(text) ? ' xml:space="preserve"' : ''
}

export function preserveTextElementXmlSpace(opening: string, text: string) {
  if (!requiresPreservedXmlSpace(text)) return opening
  if (/\s+xml:space\s*=\s*(["'])preserve\1/u.test(opening)) return opening
  const xmlSpace = /\s+xml:space\s*=\s*(["'])[^"']*\1/u
  return xmlSpace.test(opening)
    ? opening.replace(xmlSpace, ' xml:space="preserve"')
    : opening.replace(/>$/u, ' xml:space="preserve">')
}

function requiresPreservedXmlSpace(text: string) {
  return /^\s|\s$/u.test(text)
}
