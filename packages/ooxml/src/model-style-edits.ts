import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type {
  OoxmlDocument,
  ParagraphAnchor,
  TextRunAnchor,
  XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  escapeXmlAttribute,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'

export function setRunStyle(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  styleId: string | null,
) {
  const part = requireEditablePart(document, anchor.partName)
  setStyleInstruction(part.overlay, {
    key: `${anchor.wire.id}:style`,
    nodeRange: anchor.runRange,
    propertiesRange: anchor.runPropertiesRange,
    styleRange: anchor.runStyleRange,
    propertiesName: 'rPr',
    styleName: 'rStyle',
    styleId,
  })
  updateWireStyle(anchor.wire, styleId)
  part.dirty = true
}

export function setParagraphStyle(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  styleId: string | null,
) {
  const part = requireEditablePart(document, anchor.partName)
  setStyleInstruction(part.overlay, {
    key: `${anchor.wire.id}:style`,
    nodeRange: anchor.paragraphRange,
    propertiesRange: anchor.paragraphPropertiesRange,
    styleRange: anchor.paragraphStyleRange,
    propertiesName: 'pPr',
    styleName: 'pStyle',
    styleId,
  })
  updateWireStyle(anchor.wire, styleId)
  part.dirty = true
}

function setStyleInstruction(
  overlay: XmlOverlay,
  input: {
    key: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    styleRange?: XmlElementRange
    propertiesName: 'pPr' | 'rPr'
    styleName: 'pStyle' | 'rStyle'
    styleId: string | null
  },
) {
  if (input.styleRange) {
    setOverlayReplacement(overlay, input.key, {
      start: input.styleRange.start,
      end: input.styleRange.end,
      value:
        input.styleId === null
          ? ''
          : patchStyleValue(
              overlay.source.slice(
                input.styleRange.start,
                input.styleRange.end,
              ),
              'w',
              input.styleId,
            ),
    })
    return
  }
  if (input.styleId === null) {
    overlay.replacements.delete(input.key)
    return
  }

  const instruction = `<w:${input.styleName} w:val="${escapeXmlAttribute(input.styleId)}"/>`
  if (!input.propertiesRange) {
    setOverlayReplacement(overlay, input.key, {
      start: input.nodeRange.startTagEnd,
      end: input.nodeRange.startTagEnd,
      value: `<w:${input.propertiesName}>${instruction}</w:${input.propertiesName}>`,
    })
    return
  }
  if (input.propertiesRange.endTagStart === input.propertiesRange.end) {
    const opening = overlay.source.slice(
      input.propertiesRange.start,
      input.propertiesRange.end,
    )
    setOverlayReplacement(overlay, input.key, {
      start: input.propertiesRange.start,
      end: input.propertiesRange.end,
      value: expandSelfClosingProperties(
        opening,
        'w',
        input.propertiesName,
        instruction,
      ),
    })
    return
  }
  setOverlayReplacement(overlay, input.key, {
    start: input.propertiesRange.startTagEnd,
    end: input.propertiesRange.startTagEnd,
    value: instruction,
  })
}

export function patchStyleValue(
  fragment: string,
  prefix: string,
  styleId: string,
) {
  const escaped = escapeXmlAttribute(styleId)
  const value = /(\s+(?:[^\s:>]+:)?val\s*=\s*)(["'])([^"']*)\2/u
  if (value.test(fragment)) return fragment.replace(value, `$1$2${escaped}$2`)
  return fragment.replace(/(\/\s*>|>)$/u, ` ${prefix}:val="${escaped}"$1`)
}

export function expandSelfClosingProperties(
  fragment: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
  content: string,
) {
  return `${fragment.replace(/\/\s*>$/u, '>')}${content}</${prefix}:${propertiesName}>`
}

function updateWireStyle(
  wire: DocumentTextRunWire | DocumentParagraphWire,
  styleId: string | null,
) {
  if (styleId === null) delete wire.styleId
  else wire.styleId = styleId
}
