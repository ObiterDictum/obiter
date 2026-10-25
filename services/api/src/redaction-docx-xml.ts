import JSZip from 'jszip'
import { decodeXmlReferences, isWord, parseXmlElements } from '@obiter/ooxml'

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/** Fallback text boxes duplicate the modern drawing but escape model anchors. */
export async function prepareDocxForBurn(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes)
  for (const file of Object.values(zip.files)) {
    if (file.dir || !file.name.endsWith('.xml')) continue
    const source = await file.async('string')
    const elements = parseXmlElements(source)
    const replacements: Array<{ start: number; end: number; value: string }> =
      []
    for (const element of elements) {
      if (
        element.namespaceUri !== MC ||
        element.localName !== 'AlternateContent' ||
        !element.parent ||
        !isWord(element.parent, 'r')
      )
        continue
      const branch =
        elements.find(
          (child) => child.parent === element && child.localName === 'Choice',
        ) ??
        elements.find(
          (child) => child.parent === element && child.localName === 'Fallback',
        )
      if (!branch) throw new Error('Alternate content has no burnable branch.')
      const children = elements.filter((child) => child.parent === branch)
      if (
        children.some(
          (child) => !['t', 'tab', 'br'].some((name) => isWord(child, name)),
        )
      )
        throw new Error('Unsupported alternate run content.')
      for (const child of children) {
        const prefix = child.qualifiedName.split(':')[0] ?? ''
        if (
          child.namespaces?.get(prefix) !==
          element.parent.namespaces?.get(prefix)
        )
          throw new Error('Unsupported alternate run namespace.')
      }
      replacements.push({
        ...element,
        value: source.slice(branch.startTagEnd, branch.endTagStart),
      })
    }
    const fallbacks = elements.filter(
      (element) =>
        element.namespaceUri === MC &&
        element.localName === 'Fallback' &&
        elements.some(
          (child) =>
            child.start > element.start &&
            child.end < element.end &&
            isWord(child, 'txbxContent'),
        ),
    )
    replacements.push(
      ...fallbacks.map((element) => ({ ...element, value: '' })),
    )
    replacements.sort((a, b) => a.start - b.start || b.end - a.end)
    // Outermost removals also consume any nested fallback.
    let result = ''
    let cursor = 0
    for (const element of replacements) {
      if (element.start < cursor) continue
      result += source.slice(cursor, element.start) + element.value
      cursor = element.end
    }
    if (cursor) zip.file(file.name, result + source.slice(cursor))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/** Decode both attributes and text; joining leaves catches split-run copies. */
export function decodedXmlText(source: string) {
  const elements = parseXmlElements(source)
  const tags = elements
    .flatMap((element) => [
      {
        start: element.start,
        end: element.startTagEnd,
        separator: isWord(element, 'tab')
          ? '\t'
          : isWord(element, 'br')
            ? '\n'
            : '',
      },
      ...(!element.selfClosing
        ? [
            {
              start: element.endTagStart,
              end: element.end,
              separator: element.localName === 'p' ? '\n' : '',
            },
          ]
        : []),
    ])
    .sort((a, b) => a.start - b.start)
  let cursor = 0
  let text = ''
  let layoutText = ''
  for (const tag of tags) {
    const content = decodeXmlReferences(
      source
        .slice(cursor, tag.start)
        .replace(/<!--[^]*?-->|<\?[^]*?\?>/gu, '')
        .replace(/<!\[CDATA\[([^]*?)\]\]>/gu, '$1'),
    )
    text += content
    layoutText += content + tag.separator
    cursor = tag.end
  }
  const attributes = elements.flatMap((element) =>
    element.attributes.map((attribute) => attribute.value),
  )
  return [text, layoutText, ...attributes]
}
