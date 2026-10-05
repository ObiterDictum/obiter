import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { escapeXmlAttribute } from '@obiter/ooxml'
import { xmlAttr, xmlTagAttrs } from './document-page-units'
import type {
  FormatDrafts,
  NumberingDraft,
  PendingEmphasis,
} from './document-format-types'

export function formattedModel(
  model: DocumentModelWire,
  format: FormatDrafts,
): DocumentModelWire {
  const emphasisByRun = runEmphasisIndex(format)
  return {
    ...model,
    stories: model.stories.map((story) => ({
      ...story,
      paragraphs: story.paragraphs.map((paragraph) =>
        formattedParagraph(paragraph, format, emphasisByRun),
      ),
    })),
  }
}

function runEmphasisIndex(format: FormatDrafts) {
  return new Map(
    format.emphasis.flatMap((item) =>
      item.runId ? [[item.runId, item] as const] : [],
    ),
  )
}

/**
 * One paragraph as `formattedModel` would hold it: the pending style,
 * numbering and run-level emphasis applied. Control state formats only the
 * paragraphs a selection addresses, so reading one selection never rebuilds
 * the whole model, and the result is the same object `formattedModel` would
 * produce for that paragraph.
 */
export function formattedParagraphDraft(
  paragraph: DocumentParagraphWire,
  format: FormatDrafts,
): DocumentParagraphWire {
  return formattedParagraph(paragraph, format, runEmphasisIndex(format))
}

/**
 * Projects range emphasis onto one paragraph's current text. Offsets are in
 * that string, so the caller passes the paragraph after text drafts are
 * applied. Slicing first and then writing the draft onto the slice that kept
 * the original run id repeats the draft in front of the leftover tail.
 */
export function projectRangeEmphasis(
  paragraph: DocumentParagraphWire,
  emphasis: readonly PendingEmphasis[],
): DocumentParagraphWire {
  let current = paragraph
  for (const item of emphasis) {
    current = paintRangeEmphasis(current, item)
  }
  return current
}

export function paragraphStyleOptions(model: DocumentModelWire) {
  return model.styles.flatMap((style) => {
    if (!/w:type\s*=\s*"paragraph"/i.test(style.sourceFragment)) return []
    const name =
      xmlAttr(xmlTagAttrs(style.sourceFragment, 'name'), 'val') ?? style.styleId
    return [{ styleId: style.styleId, name }]
  })
}
function paintRangeEmphasis(
  paragraph: DocumentParagraphWire,
  item: PendingEmphasis,
): DocumentParagraphWire {
  if (item.paragraphId !== paragraph.id) return paragraph
  const from = item.from
  const to = item.to
  if (from === undefined || to === undefined) return paragraph
  const runs: DocumentParagraphWire['runs'] = []
  let cursor = 0
  let changed = false
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    const overlapFrom = Math.max(from, cursor)
    const overlapTo = Math.min(to, end)
    if (overlapFrom >= overlapTo) {
      runs.push(run)
    } else {
      const localFrom = snapRangeStart(run.text, overlapFrom - cursor)
      const localTo = snapRangeEnd(run.text, overlapTo - cursor)
      if (localFrom >= localTo) {
        runs.push(run)
      } else {
        changed = true
        const pieces: DocumentParagraphWire['runs'] = []
        if (localFrom > 0) {
          pieces.push({ ...run, text: run.text.slice(0, localFrom) })
        }
        pieces.push({
          ...run,
          text: run.text.slice(localFrom, localTo),
          preservedXmlFragments: patchFragments(
            run.preservedXmlFragments,
            emphasisXml(run.preservedXmlFragments, item),
            /<w:rPr\b/u,
          ),
        })
        if (localTo < run.text.length) {
          pieces.push({ ...run, text: run.text.slice(localTo) })
        }
        pieces.forEach((piece, index) => {
          runs.push(
            index === 0
              ? piece
              : {
                  ...piece,
                  id: `${run.id}:${String(localFrom)}:${String(localTo)}:${String(index)}`,
                },
          )
        })
      }
    }
    cursor = end
  }
  if (!changed) return paragraph
  return { ...paragraph, runs }
}

/** Expands a range so neither edge falls inside a surrogate pair. */
export type EmphasisRange = {
  from: number
  to: number
}

export function snapEmphasisRange(
  text: string,
  from: number,
  to: number,
): EmphasisRange {
  const start = snapRangeStart(text, Math.min(from, to))
  const end = snapRangeEnd(text, Math.max(from, to))
  return { from: start, to: Math.max(start, end) }
}

function snapRangeStart(text: string, index: number): number {
  return index > 0 && isLowSurrogate(text.charCodeAt(index)) ? index - 1 : index
}

function snapRangeEnd(text: string, index: number): number {
  return isLowSurrogate(text.charCodeAt(index))
    ? Math.min(text.length, index + 1)
    : index
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function formattedParagraph(
  paragraph: DocumentParagraphWire,
  format: FormatDrafts,
  emphasisByRun: ReadonlyMap<string, PendingEmphasis>,
): DocumentParagraphWire {
  const styleId = format.paragraphStyles[paragraph.id]
  const numbering = format.numbering[paragraph.id]
  return {
    ...paragraph,
    ...(styleId !== undefined
      ? styleId === null
        ? { styleId: undefined }
        : { styleId }
      : {}),
    preservedXmlFragments: numbering
      ? patchFragments(
          paragraph.preservedXmlFragments,
          numberingXml(paragraph.preservedXmlFragments, numbering),
          /<w:pPr\b/u,
        )
      : paragraph.preservedXmlFragments,
    runs: paragraph.runs.map((run) => {
      const emphasis = emphasisByRun.get(run.id)
      if (!emphasis) return run
      return {
        ...run,
        preservedXmlFragments: patchFragments(
          run.preservedXmlFragments,
          emphasisXml(run.preservedXmlFragments, emphasis),
          /<w:rPr\b/u,
        ),
      }
    }),
  }
}

function numberingXml(fragments: readonly string[], numbering: NumberingDraft) {
  const current =
    fragments.find((fragment) => /<w:pPr\b/u.test(fragment)) ?? '<w:pPr/>'
  const base =
    current.trim() === '' || /\/\s*>$/u.test(current)
      ? '<w:pPr/>'
      : strip(current, 'numPr')
  if (numbering.numId === null) return base
  const numPr = `<w:numPr><w:ilvl w:val="${String(numbering.ilvl ?? 0)}"/><w:numId w:val="${numbering.numId}"/></w:numPr>`
  if (/\/\s*>$/u.test(base)) {
    return `${base.replace(/\/\s*>$/u, '>')}${numPr}</w:pPr>`
  }
  return base.replace(/(<\/[^>]+>)$/u, `${numPr}$1`)
}

function emphasisXml(fragments: readonly string[], emphasis: PendingEmphasis) {
  const current =
    fragments.find((fragment) => /<w:rPr\b/u.test(fragment)) ?? '<w:rPr/>'
  let next = current
  if (emphasis.bold === true) next = upsert(next, 'b', '<w:b/>')
  if (emphasis.bold === false) next = upsert(next, 'b', '<w:b w:val="0"/>')
  if (emphasis.bold === null) next = strip(next, 'b')
  if (emphasis.italic === true) next = upsert(next, 'i', '<w:i/>')
  if (emphasis.italic === false) next = upsert(next, 'i', '<w:i w:val="0"/>')
  if (emphasis.italic === null) next = strip(next, 'i')
  if (emphasis.underline === true)
    next = upsert(next, 'u', '<w:u w:val="single"/>')
  if (emphasis.underline === false)
    next = upsert(next, 'u', '<w:u w:val="none"/>')
  if (emphasis.underline === null) next = strip(next, 'u')
  if (emphasis.strikethrough === true)
    next = upsert(next, 'strike', '<w:strike/>')
  if (emphasis.strikethrough === false)
    next = upsert(next, 'strike', '<w:strike w:val="0"/>')
  if (emphasis.strikethrough === null) next = strip(next, 'strike')
  if (emphasis.highlight !== undefined) {
    next =
      emphasis.highlight === null
        ? strip(next, 'highlight')
        : upsert(
            next,
            'highlight',
            `<w:highlight w:val="${emphasis.highlight}"/>`,
          )
  }
  if (emphasis.vertAlign !== undefined) {
    next =
      emphasis.vertAlign === null
        ? strip(next, 'vertAlign')
        : upsert(
            next,
            'vertAlign',
            `<w:vertAlign w:val="${emphasis.vertAlign}"/>`,
          )
  }
  // Font family, size and colour carry the same XML the server writes in
  // patchRunEmphasisXml: a named rFonts writes both ascii and hAnsi, a size
  // writes sz and szCs together so the Latin and complex-script runs match,
  // and both are released by removing every element that would set them.
  if (emphasis.fontFamily !== undefined) {
    next =
      emphasis.fontFamily === null
        ? strip(next, 'rFonts')
        : upsert(
            next,
            'rFonts',
            `<w:rFonts w:ascii="${escapeXmlAttribute(emphasis.fontFamily)}" w:hAnsi="${escapeXmlAttribute(emphasis.fontFamily)}"/>`,
          )
  }
  if (emphasis.fontSize !== undefined) {
    next = strip(strip(next, 'sz'), 'szCs')
    if (emphasis.fontSize !== null) {
      const size = String(emphasis.fontSize)
      next = upsert(next, 'sz', `<w:sz w:val="${size}"/>`)
      next = upsert(next, 'szCs', `<w:szCs w:val="${size}"/>`)
    }
  }
  if (emphasis.colour !== undefined) {
    next =
      emphasis.colour === null
        ? strip(next, 'color')
        : upsert(next, 'color', `<w:color w:val="${emphasis.colour}"/>`)
  }
  if (emphasis.smallCaps !== undefined) {
    next =
      emphasis.smallCaps === null
        ? strip(next, 'smallCaps')
        : upsert(
            next,
            'smallCaps',
            emphasis.smallCaps ? '<w:smallCaps/>' : '<w:smallCaps w:val="0"/>',
          )
  }
  return next
}

function upsert(fragment: string, localName: string, instruction: string) {
  const without = strip(fragment, localName)
  if (/\/\s*>$/u.test(without)) {
    return `${without.replace(/\/\s*>$/u, '>')}${instruction}</w:rPr>`
  }
  return without.replace(/(<\/[^>]+>)$/u, `${instruction}$1`)
}

function strip(fragment: string, localName: string) {
  return fragment.replace(
    new RegExp(
      `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
      'u',
    ),
    '',
  )
}

function patchFragments(
  fragments: readonly string[],
  next: string,
  match: RegExp,
) {
  const index = fragments.findIndex((fragment) => match.test(fragment))
  if (index === -1) return [...fragments, next]
  return fragments.map((fragment, fragmentIndex) =>
    fragmentIndex === index ? next : fragment,
  )
}
