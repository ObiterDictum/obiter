import { attributeValue, parseXmlElements } from './overlay'

const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types'

export type ContentTypeIndex = {
  defaults: ReadonlyMap<string, string>
  overrides: ReadonlyMap<string, string>
}

export function parseContentTypes(source: string): ContentTypeIndex {
  const defaults = new Map<string, string>()
  const overrides = new Map<string, string>()

  for (const element of parseXmlElements(source)) {
    if (element.namespaceUri !== CONTENT_TYPES_NAMESPACE) continue
    if (element.localName === 'Default') {
      defaults.set(
        requiredAttribute(element, 'Extension').toLowerCase(),
        requiredAttribute(element, 'ContentType'),
      )
    } else if (element.localName === 'Override') {
      const partName = requiredAttribute(element, 'PartName').replace(
        /^\//u,
        '',
      )
      overrides.set(partName, requiredAttribute(element, 'ContentType'))
    }
  }

  return { defaults, overrides }
}

export function isXmlPart(partName: string, contentTypes: ContentTypeIndex) {
  if (partName === '[Content_Types].xml' || partName.endsWith('.rels'))
    return true
  const extension = partName.includes('.')
    ? partName.slice(partName.lastIndexOf('.') + 1).toLowerCase()
    : ''
  const contentType =
    contentTypes.overrides.get(partName) ?? contentTypes.defaults.get(extension)
  return (
    contentType?.endsWith('+xml') === true ||
    contentType?.endsWith('/xml') === true
  )
}

function requiredAttribute(
  element: Parameters<typeof attributeValue>[0],
  localName: string,
) {
  const value = attributeValue(element, '', localName)
  if (!value) throw new Error('Content type is missing an attribute')
  return value
}
