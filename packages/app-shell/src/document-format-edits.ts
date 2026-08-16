import type {
  DocumentEditOperation,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { paragraphNumPr } from './document-page-lists'
import { xmlAttr, xmlTagAttrs } from './document-page-units'

export { paragraphNumPr } from './document-page-lists'

export type PendingEmphasis = {
  runId: string
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
}

export type NumberingDraft = {
  numId: string | null
  ilvl?: number
}

export type FormatDrafts = {
  emphasis: PendingEmphasis[]
  paragraphStyles: Record<string, string | null>
  numbering: Record<string, NumberingDraft>
}

export const emptyFormatDrafts: FormatDrafts = {
  emphasis: [],
  paragraphStyles: {},
  numbering: {},
}

export function collectFormatOperations(
  model: DocumentModelWire,
  format: FormatDrafts,
  deletedParagraphIds: readonly string[],
): DocumentEditOperation[] {
  const deleted = new Set(deletedParagraphIds)
  const deletedRuns = new Set(
    (documentStory(model)?.paragraphs ?? [])
      .filter((paragraph) => deleted.has(paragraph.id))
      .flatMap((paragraph) => paragraph.runs.map((run) => run.id)),
  )
  const operations: DocumentEditOperation[] = []
  const emphasisByRun = new Map<string, PendingEmphasis>()
  for (const item of format.emphasis) {
    if (!deletedRuns.has(item.runId)) emphasisByRun.set(item.runId, item)
  }
  for (const item of emphasisByRun.values()) {
    operations.push({
      type: 'set_run_emphasis',
      runId: item.runId,
      ...(item.bold !== undefined ? { bold: item.bold } : {}),
      ...(item.italic !== undefined ? { italic: item.italic } : {}),
      ...(item.underline !== undefined ? { underline: item.underline } : {}),
    })
  }
  for (const [paragraphId, styleId] of Object.entries(format.paragraphStyles)) {
    if (deleted.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_style',
      paragraphId,
      styleId,
    })
  }
  for (const [paragraphId, numbering] of Object.entries(format.numbering)) {
    if (deleted.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_numbering',
      paragraphId,
      numId: numbering.numId,
      ...(numbering.ilvl !== undefined ? { ilvl: numbering.ilvl } : {}),
    })
  }
  return operations
}

export function formattedModel(
  model: DocumentModelWire,
  format: FormatDrafts,
): DocumentModelWire {
  const emphasisByRun = new Map(
    format.emphasis.map((item) => [item.runId, item] as const),
  )
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

export function paragraphStyleOptions(model: DocumentModelWire) {
  return model.styles.flatMap((style) => {
    if (!/w:type\s*=\s*"paragraph"/i.test(style.sourceFragment)) return []
    const name =
      xmlAttr(xmlTagAttrs(style.sourceFragment, 'name'), 'val') ?? style.styleId
    return [{ styleId: style.styleId, name }]
  })
}

export function mergeEmphasis(
  current: PendingEmphasis[],
  next: PendingEmphasis,
): PendingEmphasis[] {
  const previous = current.find((item) => item.runId === next.runId)
  return [
    ...current.filter((item) => item.runId !== next.runId),
    { ...previous, ...next },
  ]
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

export function toggleEmphasisOnRuns(
  format: FormatDrafts,
  runIds: readonly string[],
  flag: 'bold' | 'italic' | 'underline',
  value: boolean,
): FormatDrafts {
  let emphasis = format.emphasis
  for (const runId of runIds) {
    emphasis = mergeEmphasis(emphasis, { runId, [flag]: value })
  }
  return { ...format, emphasis }
}

export function setParagraphStyleDraft(
  format: FormatDrafts,
  paragraphId: string,
  styleId: string | null,
): FormatDrafts {
  return {
    ...format,
    paragraphStyles: { ...format.paragraphStyles, [paragraphId]: styleId },
  }
}

export function indentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const ilvl = Math.min(8, (current.ilvl ?? 0) + 1)
  const instance = model.numbering.find(
    (item) => item.numberingId === current.numId,
  )
  if (!instance?.levels?.some((level) => level.ilvl === ilvl)) return format
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]: { numId: current.numId, ilvl },
    },
  }
}

export function outdentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const ilvl = current.ilvl ?? 0
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]:
        ilvl <= 0 ? { numId: null } : { numId: current.numId, ilvl: ilvl - 1 },
    },
  }
}

export type ListKind = 'bullet' | 'number'

export function listKindOf(
  model: DocumentModelWire,
  numId: string | null,
): ListKind | null {
  if (!numId) return null
  const numFmt = model.numbering
    .find((item) => item.numberingId === numId)
    ?.levels?.find((level) => level.ilvl === 0)?.numFmt
  if (numFmt === 'bullet') return 'bullet'
  if (numFmt && numFmt !== 'none') return 'number'
  return null
}

export function toggleListKind(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
  kind: ListKind,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  const activeKind = current?.numId ? listKindOf(model, current.numId) : null
  if (activeKind === kind) {
    return {
      ...format,
      numbering: { ...format.numbering, [paragraph.id]: { numId: null } },
    }
  }
  const target = model.numbering.find(
    (item) => listKindOf(model, item.numberingId) === kind,
  )
  if (!target) return format
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]: { numId: target.numberingId, ilvl: 0 },
    },
  }
}

export function continueList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const story = documentStory(model)
  if (!story) return format
  const index = story.paragraphs.findIndex((item) => item.id === paragraph.id)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = story.paragraphs[cursor]
    if (!previous) continue
    const numPr =
      format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles)
    if (!numPr?.numId) continue
    return {
      ...format,
      numbering: { ...format.numbering, [paragraph.id]: numPr },
    }
  }
  return format
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

export function formatControlState(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
) {
  const paragraph = selectedParagraph(model, paragraphId)
  const run = paragraph?.runs[0]
  const pending = run
    ? format.emphasis.find((item) => item.runId === run.id)
    : undefined
  const xml = run?.preservedXmlFragments.join('') ?? ''
  const numPr = paragraph
    ? (format.numbering[paragraph.id] ??
      paragraphNumPr(paragraph, model.styles))
    : undefined
  const story = documentStory(model)
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
    runIds: paragraph?.runs.map((item) => item.id) ?? [],
    paragraphStyleId: paragraph?.styleId ?? '',
    paragraphStyles: paragraphStyleOptions(model),
    bold: runFlagOn(xml, pending, 'bold'),
    italic: runFlagOn(xml, pending, 'italic'),
    underline: runFlagOn(xml, pending, 'underline'),
    canIndent,
    canOutdent: Boolean(numPr?.numId),
    canContinue: Boolean(previousNum?.numId),
    bulletList: numPr?.numId
      ? listKindOf(model, numPr.numId) === 'bullet'
      : false,
    numberList: numPr?.numId
      ? listKindOf(model, numPr.numId) === 'number'
      : false,
    canToggleLists: model.numbering.some(
      (item) => listKindOf(model, item.numberingId) !== null,
    ),
  }
}

export function documentFormatToolbar(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  setFormat: (update: (current: FormatDrafts) => FormatDrafts) => void,
) {
  const controls = formatControlState(model, format, paragraphId)
  const paragraph = controls.paragraph
  return {
    paragraphStyleId: controls.paragraphStyleId,
    paragraphStyles: controls.paragraphStyles,
    bold: controls.bold,
    italic: controls.italic,
    underline: controls.underline,
    canIndent: controls.canIndent,
    canOutdent: controls.canOutdent,
    canContinue: controls.canContinue,
    bulletList: controls.bulletList,
    numberList: controls.numberList,
    canToggleLists: controls.canToggleLists,
    onParagraphStyle: (styleId: string | null) => {
      if (!paragraphId) return
      setFormat((current) =>
        setParagraphStyleDraft(current, paragraphId, styleId),
      )
    },
    onToggleBold: () => {
      if (controls.runIds.length === 0) return
      setFormat((current) =>
        toggleEmphasisOnRuns(current, controls.runIds, 'bold', !controls.bold),
      )
    },
    onToggleItalic: () => {
      if (controls.runIds.length === 0) return
      setFormat((current) =>
        toggleEmphasisOnRuns(
          current,
          controls.runIds,
          'italic',
          !controls.italic,
        ),
      )
    },
    onToggleUnderline: () => {
      if (controls.runIds.length === 0) return
      setFormat((current) =>
        toggleEmphasisOnRuns(
          current,
          controls.runIds,
          'underline',
          !controls.underline,
        ),
      )
    },
    onIndent: () => {
      if (!paragraph) return
      setFormat((current) => indentList(current, model, paragraph))
    },
    onOutdent: () => {
      if (!paragraph) return
      setFormat((current) => outdentList(current, model, paragraph))
    },
    onContinueList: () => {
      if (!paragraph) return
      setFormat((current) => continueList(current, model, paragraph))
    },
    onToggleBullets: () => {
      if (!paragraph) return
      setFormat((current) =>
        toggleListKind(current, model, paragraph, 'bullet'),
      )
    },
    onToggleNumbers: () => {
      if (!paragraph) return
      setFormat((current) =>
        toggleListKind(current, model, paragraph, 'number'),
      )
    },
  }
}
