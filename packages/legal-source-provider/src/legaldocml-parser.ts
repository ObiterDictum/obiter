import { XMLParser } from 'fast-xml-parser'
import type { LegalParagraph } from '@obiter/legal-schema'
import { decodeHtml } from './document-utils'

export const legalDocMlParser = { id: 'legaldocml', version: 1 } as const
export const htmlParser = { id: 'html', version: 1 } as const
export type ParserIdentity = { id: string; version: number }

type OrderedNode = Record<string, unknown>

const attributeKey = ':@'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  preserveOrder: true,
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
})

function childrenOf(node: OrderedNode, tag: string): OrderedNode[] {
  const value = node[tag]
  return Array.isArray(value) ? value : []
}

function attributeMap(node: OrderedNode): Record<string, string> {
  const raw = node[attributeKey]
  if (typeof raw !== 'object' || raw === null) return {}
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

function directChild(nodes: OrderedNode[], tag: string): OrderedNode[] {
  for (const node of nodes) {
    if (tag in node) return childrenOf(node, tag)
  }

  return []
}

function findFirst(nodes: OrderedNode[], tag: string): OrderedNode[] | null {
  for (const node of nodes) {
    if (tag in node) return childrenOf(node, tag)

    for (const key of Object.keys(node)) {
      if (key.startsWith('@') || key === '#text') continue
      const found = findFirst(childrenOf(node, key), tag)
      if (found) return found
    }
  }

  return null
}

function collectText(nodes: OrderedNode[], skip: ReadonlySet<string>): string {
  let text = ''

  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === attributeKey) continue
      if (key === '#text') {
        text += String(node[key] ?? '')
        continue
      }
      if (key.startsWith('@') || skip.has(key)) continue
      text += ` ${collectText(childrenOf(node, key), skip)}`
    }
  }

  return text
}

function normalise(text: string) {
  return decodeHtml(text).replace(/\s+/g, ' ').trim()
}

function collectInlineText(nodes: OrderedNode[]): string {
  let text = ''

  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === attributeKey) continue
      if (key === '#text') {
        text += String(node[key] ?? '')
        continue
      }
      if (key.startsWith('@')) continue
      if (key === 'br') {
        text += ' '
        continue
      }
      text += collectInlineText(childrenOf(node, key))
    }
  }

  return text
}

const skipNum: ReadonlySet<string> = new Set(['num'])
const skipNothing: ReadonlySet<string> = new Set()

function paragraphNumberFrom(
  numText: string,
  eId: string | undefined,
  position: number,
): number {
  const fromNum = numText.match(/\d+/)?.[0]
  if (fromNum && Number(fromNum) > 0) return Number(fromNum)

  const fromEid = eId?.match(/(\d+)/)?.[1]
  if (fromEid && Number(fromEid) > 0) return Number(fromEid)

  return position
}

export function parseLegalDocMlParagraphs(
  xml: string,
  documentId: string,
): LegalParagraph[] | null {
  let parsed: OrderedNode[]
  try {
    const result = parser.parse(xml)
    if (!Array.isArray(result)) return null
    parsed = result
  } catch {
    return null
  }

  const body = findFirst(parsed, 'judgmentBody')
  if (!body) return null

  const decision = findFirst(body, 'decision') ?? body
  const paragraphs: LegalParagraph[] = []

  function appendToPrevious(text: string) {
    const previous = paragraphs.at(-1)
    if (previous) previous.text = `${previous.text} ${text}`
  }

  function visit(nodes: OrderedNode[]) {
    for (const node of nodes) {
      const tag = Object.keys(node).find(
        (key) => key !== attributeKey && key !== '#text',
      )
      if (!tag) continue

      const children = childrenOf(node, tag)

      if (tag === 'paragraph') {
        const numText = normalise(
          collectText(directChild(children, 'num'), skipNothing),
        )
        const text = normalise(collectText(children, skipNum))
        if (!text) continue

        const attributes = attributeMap(node)
        paragraphs.push({
          id: `${documentId}-p${paragraphs.length + 1}`,
          documentId,
          paragraphNumber: paragraphNumberFrom(
            numText,
            attributes['@eId'],
            paragraphs.length + 1,
          ),
          text,
        })
        continue
      }

      if (tag === 'level') {
        visit(children)
        continue
      }

      const text = normalise(collectText(children, skipNothing))
      if (text) appendToPrevious(text)
    }
  }

  visit(decision)

  return paragraphs.length > 0 ? paragraphs : null
}

export interface LegalDocMlMetadata {
  title: string | null
  dateDecided: string | null
  neutralCitation: string | null
}

function parseOrdered(xml: string): OrderedNode[] | null {
  try {
    const result = parser.parse(xml)
    return Array.isArray(result) ? result : null
  } catch {
    return null
  }
}

export function extractLegalDocMlMetadata(xml: string): LegalDocMlMetadata {
  const parsed = parseOrdered(xml)
  if (!parsed) return { title: null, dateDecided: null, neutralCitation: null }

  const work = findFirst(parsed, 'FRBRWork')
  const attributesOf = (nodes: OrderedNode[] | null, tag: string) => {
    if (!nodes) return undefined
    for (const node of nodes) {
      if (tag in node) return attributeMap(node)
    }
    return undefined
  }

  const citationNodes = findFirst(parsed, 'neutralCitation')

  return {
    title: attributesOf(work, 'FRBRname')?.['@value'] ?? null,
    dateDecided:
      attributesOf(work, 'FRBRdate')?.['@date']?.slice(0, 10) ?? null,
    neutralCitation: citationNodes
      ? normalise(collectText(citationNodes, skipNothing)) || null
      : null,
  }
}

export function extractLegalDocMlJudges(xml: string): string[] {
  const parsed = parseOrdered(xml)
  if (!parsed) return []
  const header = findFirst(parsed, 'header')
  if (!header) return []

  const names: string[] = []
  const visit = (nodes: OrderedNode[]) => {
    for (const node of nodes) {
      for (const key of Object.keys(node)) {
        if (key === attributeKey || key === '#text' || key.startsWith('@'))
          continue
        const children = childrenOf(node, key)
        if (key === 'judge') {
          const name = normalise(collectInlineText(children))
          if (name && !names.includes(name)) names.push(name)
          continue
        }
        visit(children)
      }
    }
  }
  visit(header)

  return names
}

export interface LegalDocMlPressSummary {
  summaryOf: string | null
  paragraphs: string[]
}

export function extractLegalDocMlPressSummary(
  xml: string,
): LegalDocMlPressSummary | null {
  const parsed = parseOrdered(xml)
  if (!parsed) return null
  const body = findFirst(parsed, 'mainBody')
  if (!body) return null

  const paragraphs: string[] = []
  const visit = (nodes: OrderedNode[]) => {
    for (const node of nodes) {
      for (const key of Object.keys(node)) {
        if (key === attributeKey || key === '#text' || key.startsWith('@'))
          continue
        const children = childrenOf(node, key)
        if (key === 'p') {
          const text = normalise(collectInlineText(children))
          if (text) paragraphs.push(text)
          continue
        }
        visit(children)
      }
    }
  }
  visit(body)

  if (paragraphs.length === 0) return null

  const summaryOfNodes = findFirst(parsed, 'summaryOf')

  return {
    summaryOf: summaryOfNodes
      ? normalise(collectText(summaryOfNodes, skipNothing)) || null
      : null,
    paragraphs,
  }
}
