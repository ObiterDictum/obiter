import { exactMatchPunctuationFolds } from '@obiter/search-client'

const terminalStatusAnnotation = /\s*\(repealed\)\s*$/i

const titleFillerTokens = new Set(['etc'])

const titleSeparatorCharacters = new Set([
  '.',
  ',',
  ';',
  ':',
  '"',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '-',
])

export interface FoldedTitlePiece {
  value: string
  start: number
  end: number
}

export function foldTitlePieces(value: string): FoldedTitlePiece[] {
  const source = value.normalize('NFKC')
  const status = terminalStatusAnnotation.exec(source)
  const text = status ? source.slice(0, status.index) : source
  const characters: Array<{ character: string; offset: number }> = []
  for (let index = 0; index < text.length; index += 1) {
    let character = text[index]!
    for (const [from, to] of exactMatchPunctuationFolds) {
      character = character.replaceAll(from, to)
    }
    character = character.toLowerCase()
    if (character === '&') {
      for (const replacement of ' and ') {
        characters.push({ character: replacement, offset: index })
      }
      continue
    }
    if (character === "'") continue
    if (/\s/.test(character) || titleSeparatorCharacters.has(character)) {
      characters.push({ character: ' ', offset: index })
      continue
    }
    characters.push({ character, offset: index })
  }
  const pieces: FoldedTitlePiece[] = []
  let current: FoldedTitlePiece | null = null
  for (const { character, offset } of characters) {
    if (character === ' ') {
      if (current) pieces.push(current)
      current = null
      continue
    }
    if (!current) current = { value: '', start: offset, end: offset + 1 }
    current.value += character
    current.end = offset + 1
  }
  if (current) pieces.push(current)
  return pieces.filter(
    (piece) => piece.value.length > 0 && !titleFillerTokens.has(piece.value),
  )
}

export function normalizeActTitle(value: string): string {
  return foldTitlePieces(value)
    .map((piece) => piece.value)
    .join(' ')
}

const openingToClosing: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
])
const closingToOpening: ReadonlyMap<string, string> = new Map(
  [...openingToClosing].map(([opening, closing]) => [closing, opening]),
)

export interface BracketStructure {
  depthBefore: number[]
  balanced: boolean
}

export function readBracketStructure(value: string): BracketStructure {
  const depthBefore = Array.from({ length: value.length + 1 }, () => 0)
  const open: string[] = []
  let depth = 0
  let balanced = true
  for (let index = 0; index < value.length; index += 1) {
    depthBefore[index] = depth
    const character = value[index]!
    if (openingToClosing.has(character)) {
      open.push(character)
      depth += 1
      continue
    }
    const opening = closingToOpening.get(character)
    if (opening === undefined) continue
    if (open.pop() !== opening) balanced = false
    depth = Math.max(0, depth - 1)
  }
  depthBefore[value.length] = depth
  if (depth !== 0) balanced = false
  return { depthBefore, balanced }
}

export function looseActTitleKey(value: string): string {
  return normalizeActTitle(value).replace(/[^a-z0-9]/g, '')
}

const wrappingQuotes: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
])

const trailingTitlePunctuation = /[\s.,;:!?)\]}"'\u201D\u2019]+$/

const terminalPresentationAnnotations: readonly string[] = Object.freeze([
  String.raw`\s*\(\s*repealed\s*\)`,
  String.raw`\s*,\s*as\s+amended`,
])

const terminalPresentationBoundary = new RegExp(
  `(?:${terminalPresentationAnnotations.join('|')})[\\s.,;:!?)\\]}"'\u201D\u2019]*$`,
  'i',
)

function stripTerminalPresentation(value: string): string {
  let core = value
  const budget = (value.match(/repealed|amended/gi) ?? []).length
  for (let pass = 0; pass <= budget; pass += 1) {
    const next = core.replace(terminalPresentationBoundary, '').trim()
    if (next === core) return core
    core = next
  }
  return core
}

const maxBoundaryPasses = 8

export function trimTitleBoundary(value: string): string {
  let core = value.trim()
  for (let pass = 0; pass < maxBoundaryPasses; pass += 1) {
    const before = core
    const first = core[0]
    const last = core[core.length - 1]
    if (
      first !== undefined &&
      last !== undefined &&
      wrappingQuotes.get(first) === last
    ) {
      core = core.slice(1, -1).trim()
    }
    core = stripTerminalPresentation(core)
    core = core.replace(trailingTitlePunctuation, '').trim()
    if (core === before) return core
  }
  return core
}
