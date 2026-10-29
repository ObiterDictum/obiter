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
  if (!part || !overlay || anchor.textRanges.length === 0) return false
  if (hasPendingBreakSplice(overlay, anchor.runRange)) {
    throw new OoxmlError('invalid-document-edit')
  }

  const breakReplacements = lineBreakRunReplacements(
    anchor,
    text,
    overlay.source,
    0,
  )
  const replacements =
    breakReplacements ??
    anchor.textRanges.map((range, index) => ({
      ...range,
      value: index === 0 ? escapeXmlText(text) : '',
    }))
  const overlayReplacements = [
    ...replacements,
    ...textBreakReplacements(anchor, 0),
  ]
  overlayReplacements.forEach((replacement, index) => {
    setOverlayReplacement(
      overlay,
      `${anchor.wire.id}:text:${index}`,
      replacement,
    )
  })
  const firstTextElement = anchor.textElements[0]
  if (!breakReplacements && firstTextElement) {
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
      const element = textElementXml(prefix, line)
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
            .map((rest) => `<${prefix}:br/>${textElementXml(prefix, rest)}`)
            .join('')
        : index < lines.length - 1
          ? `<${prefix}:br/>`
          : ''
    return {
      start: element.start - origin,
      end: element.end - origin,
      value: `${textElementXml(prefix, line)}${extra}`,
    }
  })
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
