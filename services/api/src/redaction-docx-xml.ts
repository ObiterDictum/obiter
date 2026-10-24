import JSZip from 'jszip'
import { decodeXmlReferences, isWord, parseXmlElements } from '@obiter/ooxml'

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/** Fallback text boxes duplicate the modern drawing but escape model anchors. */
export async function removeFallbackTextBoxes(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes)
  for (const file of Object.values(zip.files)) {
    if (file.dir || !file.name.endsWith('.xml')) continue
    const source = await file.async('string')
    const elements = parseXmlElements(source)
    const fallbacks = elements.filter((element) =>
      element.namespaceUri === MC && element.localName === 'Fallback' &&
      elements.some((child) => child.start > element.start && child.end < element.end && isWord(child, 'txbxContent')),
    )
    // Outermost removals also consume any nested fallback.
    let result = ''
    let cursor = 0
    for (const element of fallbacks) {
      if (element.start < cursor) continue
      result += source.slice(cursor, element.start)
      cursor = element.end
    }
    if (cursor) zip.file(file.name, result + source.slice(cursor))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/** Decode both attributes and text; joining leaves catches split-run copies. */
export function decodedXmlText(source: string) {
  const elements = parseXmlElements(source)
  const parents = new Set(elements.map((element) => element.parent))
  const leaves = elements.filter((element) => !parents.has(element))
  const text = leaves.map((element) => decodeXmlReferences(source.slice(element.startTagEnd, element.endTagStart))).join('')
  const attributes = elements.flatMap((element) => element.attributes.map((attribute) => attribute.value))
  return [text, ...attributes]
}
