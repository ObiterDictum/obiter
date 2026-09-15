import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { paragraphNumPr } from './document-page-lists'
import { xmlAttr, xmlTagAttrs } from './document-page-units'
import { paragraphListKind, pickNumberingId } from './document-list-toggle'
import type {
  FormatDrafts,
  NumberingDraft,
  PendingEmphasis,
} from './document-format-types'

export function formattedModel(
  model: DocumentModelWire,
  format: FormatDrafts,
): DocumentModelWire {
  const emphasisByRun = new Map(
    format.emphasis.flatMap((item) =>
      item.runId ? [[item.runId, item] as const] : [],
    ),
  )
  const rangeEmphasis = format.emphasis.filter(
    (item) =>
      item.paragraphId && item.from !== undefined && item.to !== undefined,
  )
  return {
    ...model,
    stories: model.stories.map((story) => ({
      ...story,
      paragraphs: story.paragraphs.map((paragraph) =>
        formattedParagraph(
          rangeEmphasis.reduce(
            (current, item) => paintRangeEmphasis(current, item),
            paragraph,
          ),
          format,
          emphasisByRun,
        ),
      ),
    })),
  }
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
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    const overlapFrom = Math.max(from, cursor)
    const overlapTo = Math.min(to, end)
    if (overlapFrom >= overlapTo) {
      runs.push(run)
    } else {
      const localFrom = overlapFrom - cursor
      const localTo = overlapTo - cursor
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
    cursor = end
  }
  return { ...paragraph, runs }
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

export function selectedParagraph(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return undefined
  return documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
}
export function runFlagOn(
  xml: string,
  pending: PendingEmphasis | undefined,
  flag: 'bold' | 'italic' | 'underline',
) {
  if (pending?.[flag] === true) return true
  if (pending?.[flag] === false || pending?.[flag] === null) return false
  if (flag === 'underline') {
    return /<w:u\b(?![^>]*w:val="none")/i.test(xml)
  }
  const name = flag === 'bold' ? 'b' : 'i'
  return new RegExp(`<w:${name}\\b(?![^>]*w:val="0")`, 'i').test(xml)
}

function runsCoveringRange(
  paragraph: DocumentParagraphWire | undefined,
  selection: { from: number; to: number } | undefined,
) {
  if (!paragraph) return []
  const from = Math.min(selection?.from ?? 0, selection?.to ?? 0)
  const to = Math.max(selection?.from ?? 0, selection?.to ?? 0)
  let cursor = 0
  const covered: DocumentParagraphWire['runs'] = []
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from === to) {
      if (from >= cursor && from < end) return [run]
    } else if (Math.max(from, cursor) < Math.min(to, end)) {
      covered.push(run)
    }
    cursor = end
  }
  if (from === to) {
    const last = paragraph.runs[paragraph.runs.length - 1]
    return last ? [last] : []
  }
  return covered
}

function flagOnCoveredRuns(
  runs: DocumentParagraphWire['runs'],
  format: FormatDrafts,
  flag: 'bold' | 'italic' | 'underline',
) {
  return (
    runs.length > 0 &&
    runs.every((run) =>
      runFlagOn(
        run.preservedXmlFragments.join(''),
        format.emphasis.find((item) => item.runId === run.id),
        flag,
      ),
    )
  )
}

// e40-selection-format-state: pressed flags follow the covered runs, not runs[0]
// e42-painted-format-control: cover painted splits, not the unsplit source paragraph
export function formatControlState(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  selection?: { from: number; to: number },
) {
  const view = formattedModel(model, format)
  const paragraph = selectedParagraph(view, paragraphId)
  const covered = runsCoveringRange(paragraph, selection)
  const numPr = paragraph
    ? (format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, view.styles))
    : undefined
  const story = documentStory(view)
  const index =
    story?.paragraphs.findIndex((item) => item.id === paragraphId) ?? -1
  const previous = index > 0 ? story?.paragraphs[index - 1] : undefined
  const previousNum = previous
    ? (format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles))
    : undefined
  const nextIlvl = (numPr?.ilvl ?? 0) + 1
  const canIndent = Boolean(
    numPr?.numId &&
    model.numbering
      .find((item) => item.numberingId === numPr.numId)
      ?.levels?.some((level) => level.ilvl === nextIlvl),
  )
  return {
    paragraph,
    // A pending insert is not part of the stored story, so its style lives only
    // in the format drafts until the insert is saved. Report it so the style
    // control shows the chosen style instead of "No direct style".
    paragraphStyleId:
      paragraph?.styleId ??
      (paragraphId ? (format.paragraphStyles[paragraphId] ?? '') : ''),
    paragraphStyles: paragraphStyleOptions(model),
    bold: flagOnCoveredRuns(covered, format, 'bold'),
    italic: flagOnCoveredRuns(covered, format, 'italic'),
    underline: flagOnCoveredRuns(covered, format, 'underline'),
    canIndent,
    canOutdent: Boolean(numPr?.numId),
    canContinue: Boolean(previousNum?.numId),
    listKind: paragraphListKind(model, format, paragraph),
    canApplyBullet: Boolean(pickNumberingId(model, 'bullet')),
    canApplyNumber: Boolean(pickNumberingId(model, 'number')),
    canApplyMultilevel: Boolean(pickNumberingId(model, 'multilevel')),
  }
}
