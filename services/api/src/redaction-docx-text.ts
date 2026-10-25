import {
  parseXmlElements,
  type OoxmlDocument,
  type XmlElement,
} from '@obiter/ooxml'
import { RedactionDocxBurnError } from './redaction-docx-error'

type BurnPart = {
  source: string
  elements: XmlElement[]
  children: Map<number, XmlElement[]>
}
// Anchors address the immutable overlay source, never the queued replacements.
const parts = new WeakMap<OoxmlDocument, Map<string, BurnPart>>()

export function readBurnPart(
  document: OoxmlDocument,
  partName: string,
): BurnPart {
  let cache = parts.get(document)
  if (!cache) {
    cache = new Map()
    parts.set(document, cache)
  }
  const source = document.sourceParts.get(partName)?.overlay?.source
  if (source === undefined)
    throw new RedactionDocxBurnError('Redaction source XML is unavailable.')
  const cached = cache.get(partName)
  if (cached?.source === source) return cached
  const elements = parseXmlElements(source)
  const children = new Map<number, XmlElement[]>()
  for (const element of elements) {
    if (!element.parent) continue
    const key = element.parent.start
    const siblings = children.get(key) ?? []
    siblings.push(element)
    children.set(key, siblings)
  }
  const part = { source, elements, children }
  cache.set(partName, part)
  return part
}
