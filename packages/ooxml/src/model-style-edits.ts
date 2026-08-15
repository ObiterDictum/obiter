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
import { writePropertyChildren } from './model-properties'
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
    id: anchor.wire.id,
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
    id: anchor.wire.id,
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
    id: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    styleRange?: XmlElementRange
    propertiesName: 'pPr' | 'rPr'
    styleName: 'pStyle' | 'rStyle'
    styleId: string | null
  },
) {
  if (input.styleRange) {
    setOverlayReplacement(overlay, `${input.id}:${input.styleName}`, {
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
    overlay.replacements.delete(`${input.id}:${input.styleName}`)
    const created = overlay.replacements.get(
      `${input.id}:${input.propertiesName}`,
    )
    if (created) {
      const withoutStyle = created.value.replace(
        new RegExp(
          `<w:${input.styleName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${input.styleName}>)`,
          'u',
        ),
        '',
      )
      overlay.replacements.set(`${input.id}:${input.propertiesName}`, {
        ...created,
        value: withoutStyle,
      })
    }
    return
  }
  writePropertyChildren(overlay, {
    id: input.id,
    nodeRange: input.nodeRange,
    propertiesRange: input.propertiesRange,
    propertiesName: input.propertiesName,
    children: [
      {
        localName: input.styleName,
        instruction: `<w:${input.styleName} w:val="${escapeXmlAttribute(input.styleId)}"/>`,
        apply: true,
      },
    ],
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

function updateWireStyle(
  wire: DocumentTextRunWire | DocumentParagraphWire,
  styleId: string | null,
) {
  if (styleId === null) delete wire.styleId
  else wire.styleId = styleId
}
