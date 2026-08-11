import type { OoxmlDocument, TextRunAnchor } from './model'
import { escapeXmlText, setOverlayReplacement } from './parts/overlay'

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

  anchor.textRanges.forEach((range, index) => {
    setOverlayReplacement(overlay, `${anchor.wire.id}:text:${index}`, {
      ...range,
      value: index === 0 ? escapeXmlText(text) : '',
    })
  })
  const firstTextElement = anchor.textElements[0]
  if (firstTextElement && /^\s|\s$/u.test(text)) {
    const opening = overlay.source.slice(
      firstTextElement.start,
      firstTextElement.startTagEnd,
    )
    const xmlSpace = /\s+xml:space\s*=\s*(["'])[^"']*\1/u
    if (!/\s+xml:space\s*=\s*(["'])preserve\1/u.test(opening)) {
      setOverlayReplacement(overlay, `${anchor.wire.id}:xml-space`, {
        start: firstTextElement.start,
        end: firstTextElement.startTagEnd,
        value: xmlSpace.test(opening)
          ? opening.replace(xmlSpace, ' xml:space="preserve"')
          : opening.replace(/>$/u, ' xml:space="preserve">'),
      })
    }
  }
  anchor.wire.text = text
  part.dirty = true
  return true
}
