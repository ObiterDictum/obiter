import type { OoxmlDocument, TextRunAnchor } from './model'
import {
  escapeXmlText,
  setOverlayReplacement,
  type OverlayReplacement,
} from './parts/overlay'

// P10: extracting replaceTextRunText changed overlay keys to the run-scoped
// `:text:` namespace, added xml:space for whitespace-bounded replacements, and
// changed an unavailable target from model-node-not-found to model-node-not-editable.
export function replaceTextRunAtAnchor(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  text: string,
) {
  const part = document.sourceParts.get(anchor.partName)
  const overlay = part?.overlay
  if (!part || !overlay || anchor.textRanges.length === 0) return false

  const breakReplacement = lineBreakElementReplacement(
    anchor,
    text,
    overlay.source,
    0,
  )
  if (breakReplacement) {
    setOverlayReplacement(overlay, `${anchor.wire.id}:text:0`, breakReplacement)
    anchor.wire.text = text
    part.dirty = true
    return true
  }

  anchor.textRanges.forEach((range, index) => {
    setOverlayReplacement(overlay, `${anchor.wire.id}:text:${index}`, {
      ...range,
      value: index === 0 ? escapeXmlText(text) : '',
    })
  })
  const firstTextElement = anchor.textElements[0]
  if (firstTextElement) {
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

export function wordRunInnerTextXml(prefix: string, text: string) {
  return text
    .split(/\r\n|\r|\n/u)
    .map((line, index) => {
      const element = `<${prefix}:t${textElementXmlSpaceAttribute(line)}>${escapeXmlText(line)}</${prefix}:t>`
      return index === 0 ? element : `<${prefix}:br/>${element}`
    })
    .join('')
}

export function lineBreakElementReplacement(
  anchor: TextRunAnchor,
  text: string,
  source: string,
  origin: number,
): OverlayReplacement | undefined {
  if (!/[\r\n]/u.test(text)) return undefined
  const first = anchor.textElements[0]
  const last = anchor.textElements.at(-1)
  if (!first || !last) return undefined
  const opening = source.slice(first.start, first.startTagEnd)
  const prefix = opening.match(/^<([^:>\s]+):/u)?.[1] ?? 'w'
  return {
    start: first.start - origin,
    end: last.end - origin,
    value: wordRunInnerTextXml(prefix, text),
  }
}

export function textElementXmlSpaceAttribute(text: string) {
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
