import type {
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { WORD_2010_NAMESPACE } from './document-identity'
import {
  recordInsertedParagraph,
  type LineageRecorder,
} from './document-lineage'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type SourcePart,
  type TextRunAnchor,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { attributeValue, isWord, WORD_NAMESPACE } from './parts/xml-elements'
import {
  addXmlStoryPart,
  appendRelationship,
  ensureMediaContentType,
  insertRootChildXml,
  nextSyntheticParaId,
  relationshipsPartName,
} from './structure-package'
import { spliceInlineXml, spliceRunWires } from './structure-splice'
import {
  buildFootnoteReferenceRunXml,
  buildFootnoteSeparatorXml,
  buildFootnotesRootXml,
  buildFootnoteXml,
  FOOTNOTES_CONTENT_TYPE,
  FOOTNOTES_PART_NAME,
  FOOTNOTES_RELATIONSHIP_TYPE,
  missingFootnoteStyles,
} from './structure-xml'

const FOOTNOTE_REFERENCE_STYLE = 'FootnoteReference'
const FOOTNOTE_TEXT_STYLE = 'FootnoteText'
const FOOTNOTE_ID =
  /<w:footnote\b[^>]*\bw:id="(-?\d+)"|<w:footnoteReference\b[^>]*\bw:id="(-?\d+)"/gu

export function insertFootnote(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  offset: number,
  text: string,
  occurrence: number,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const footnotes = ensureFootnotesStory(document, lineage)
  ensureFootnoteStyles(document)
  const footnoteId = nextFootnoteId(
    document.model.stories,
    footnotes.part.overlay,
  )
  const paraId = nextSyntheticParaId(footnotes.part.overlay)
  const entryXml = withDeclaredNamespaces(
    footnotes.part,
    buildFootnoteXml(footnoteId, text, paraId),
  )
  insertRootChildXml(
    footnotes.part.overlay,
    'footnotes',
    entryXml,
    `footnote-${String(footnoteId)}`,
  )
  footnotes.part.dirty = true
  spliceInlineXml(
    part.overlay,
    paragraph,
    offset,
    buildFootnoteReferenceRunXml(footnoteId),
    `${paragraph.wire.id}:footnote:${String(occurrence)}`,
  )
  part.dirty = true

  const referenceWire: DocumentTextRunWire = {
    id: allocateModelId(document, 'text-edit'),
    styleId: FOOTNOTE_REFERENCE_STYLE,
    text: '',
    preservedXmlFragments: [
      `<w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE_STYLE}"/><w:vertAlign w:val="superscript"/></w:rPr>`,
      `<w:footnoteReference w:id="${String(footnoteId)}"/>`,
    ],
  }
  spliceRunWires(
    paragraph.wire,
    offset,
    [referenceWire],
    () => allocateModelId(document, 'text-edit'),
    lineage?.recorder,
  )
  const noteWire = noteParagraphWire(document, paraId, text)
  footnotes.story.preservedXmlFragments.push(entryXml)
  footnotes.story.paragraphs.push(noteWire)
  if (lineage) {
    lineage.recorder.runOrigins.set(referenceWire, [
      { fromRunId: null, fromOffset: 0, toOffset: 0 },
    ])
    recordInsertedParagraph(lineage.recorder, noteWire, lineage.operationIndex)
  }
}

const REFERENCE_ONLY_RUN =
  /^<w:r\b[^>]*>(?:<w:rPr\b[^>]*\/>|<w:rPr\b[\s\S]*?<\/w:rPr>)?<w:footnoteReference\b[^>]*\/><\/w:r>$/u

export function deleteFootnote(
  document: OoxmlDocument,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
) {
  const part = requireEditablePart(document, run.partName)
  const runXml = part.overlay.source.slice(run.runRange.start, run.runRange.end)
  const footnoteId = /<w:footnoteReference\b[^>]*\bw:id="(\d+)"/u.exec(
    runXml,
  )?.[1]
  if (
    run.wire.text !== '' ||
    footnoteId === undefined ||
    /customMarkFollows/u.test(runXml) ||
    !REFERENCE_ONLY_RUN.test(runXml)
  ) {
    throw new OoxmlError('model-node-not-editable')
  }
  const notes = document.model.stories.find(
    (story) => story.kind === 'footnotes',
  )
  if (!notes) throw new OoxmlError('invalid-document-edit')
  const notesPart = requireEditablePart(document, notes.partName)
  const entry = parseXmlElements(notesPart.overlay.source).find(
    (element) =>
      isWord(element, 'footnote') &&
      attributeValue(element, WORD_NAMESPACE, 'id') === footnoteId,
  )
  if (!entry) throw new OoxmlError('invalid-document-edit')

  setOverlayReplacement(part.overlay, `delete-footnote-ref-${run.wire.id}`, {
    start: run.runRange.start,
    end: run.runRange.end,
    value: '',
  })
  part.dirty = true
  paragraph.wire.runs = paragraph.wire.runs.filter(
    (item) => item.id !== run.wire.id,
  )

  const stillReferenced = document.model.stories
    .filter((story) => story.kind === 'document')
    .some((story) =>
      story.paragraphs.some((item) =>
        item.runs.some((other) =>
          other.preservedXmlFragments.some((fragment) =>
            new RegExp(
              `<w:footnoteReference\\b[^>]*\\bw:id="${footnoteId}"`,
              'u',
            ).test(fragment),
          ),
        ),
      ),
    )
  if (stillReferenced) return
  setOverlayReplacement(notesPart.overlay, `delete-footnote-${footnoteId}`, {
    start: entry.start,
    end: entry.end,
    value: '',
  })
  notesPart.dirty = true
  let cursor = 0
  const fragments: string[] = []
  const paragraphs: DocumentParagraphWire[] = []
  for (const fragment of notes.preservedXmlFragments) {
    const count = Math.max(1, (fragment.match(/<w:p\b/gu) ?? []).length)
    const own = notes.paragraphs.slice(cursor, cursor + count)
    cursor += count
    const id = /^<w:footnote\b[^>]*\bw:id="(-?\d+)"/u.exec(fragment)?.[1]
    if (id === footnoteId) continue
    fragments.push(fragment)
    paragraphs.push(...own)
  }
  paragraphs.push(...notes.paragraphs.slice(cursor))
  notes.preservedXmlFragments = fragments
  notes.paragraphs = paragraphs
}

const STYLES_PART_NAME = 'word/styles.xml'

function ensureFootnoteStyles(document: OoxmlDocument) {
  if (!document.sourceParts.has(STYLES_PART_NAME)) return
  const missing = missingFootnoteStyles(document.model.styles)
  if (missing.length === 0) return
  const part = requireEditablePart(document, STYLES_PART_NAME)
  for (const style of missing) {
    insertRootChildXml(
      part.overlay,
      'styles',
      style.sourceFragment,
      `style-${style.styleId}`,
    )
    document.model.styles.push(style)
  }
  part.dirty = true
}

function ensureFootnotesStory(
  document: OoxmlDocument,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const story = document.model.stories.find((item) => item.kind === 'footnotes')
  if (story) {
    return {
      part: requireEditablePart(document, story.partName),
      story,
    }
  }
  if (document.sourceParts.has(FOOTNOTES_PART_NAME)) {
    throw new OoxmlError('invalid-package')
  }
  addXmlStoryPart(document, FOOTNOTES_PART_NAME, buildFootnotesRootXml(), [
    relationshipsPartName('word/document.xml'),
  ])
  ensureMediaContentType(
    document,
    FOOTNOTES_PART_NAME,
    'xml',
    FOOTNOTES_CONTENT_TYPE,
  )
  appendRelationship(document, 'word/document.xml', {
    type: FOOTNOTES_RELATIONSHIP_TYPE,
    target: 'footnotes.xml',
  })
  const part = requireEditablePart(document, FOOTNOTES_PART_NAME)
  const created: DocumentStoryWire = {
    partName: FOOTNOTES_PART_NAME,
    kind: 'footnotes',
    paragraphs: [],
    preservedXmlFragments: [],
    fields: [],
    unanchoredFieldParagraphIds: [],
  }
  for (const entry of SEPARATOR_ENTRIES) {
    const paraId = nextSyntheticParaId(part.overlay)
    const entryXml = buildFootnoteSeparatorXml(
      entry.footnoteId,
      entry.kind,
      paraId,
    )
    insertRootChildXml(
      part.overlay,
      'footnotes',
      entryXml,
      `footnote-${String(entry.footnoteId)}`,
    )
    created.preservedXmlFragments.push(entryXml)
    const wire = separatorParagraphWire(document, entry.kind, paraId)
    created.paragraphs.push(wire)
    if (lineage) {
      recordInsertedParagraph(lineage.recorder, wire, lineage.operationIndex)
    }
  }
  document.model.stories.push(created)
  return { part, story: created }
}

function withDeclaredNamespaces(
  part: SourcePart & { kind: 'xml'; overlay: XmlOverlay },
  entryXml: string,
) {
  const root = parseXmlElements(part.overlay.source).find(
    (element) => element.depth === 0,
  )
  if (!root) throw new OoxmlError('invalid-package')
  const startTag = part.overlay.source.slice(root.start, root.startTagEnd)
  let declarations = ''
  if (!startTag.includes(`xmlns:w="${WORD_NAMESPACE}"`)) {
    declarations += ` xmlns:w="${WORD_NAMESPACE}"`
  }
  if (!startTag.includes(`xmlns:w14="${WORD_2010_NAMESPACE}"`)) {
    declarations += ` xmlns:w14="${WORD_2010_NAMESPACE}"`
  }
  if (!declarations) return entryXml
  return entryXml.replace(/^<w:footnote\b/u, `<w:footnote${declarations}`)
}

const SEPARATOR_ENTRIES = [
  { footnoteId: -1, kind: 'separator' },
  { footnoteId: 0, kind: 'continuationSeparator' },
] as const

function separatorParagraphWire(
  document: OoxmlDocument,
  kind: 'separator' | 'continuationSeparator',
  paraId: string,
): DocumentParagraphWire {
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    runs: [
      {
        id: allocateModelId(document, 'text-edit'),
        text: '',
        preservedXmlFragments: [`<w:${kind}/>`],
      },
    ],
    preservedXmlFragments: [],
  }
}

function noteParagraphWire(
  document: OoxmlDocument,
  paraId: string,
  text: string,
): DocumentParagraphWire {
  return {
    id: `para-w14-${paraId}`,
    sourceParaId: paraId,
    styleId: FOOTNOTE_TEXT_STYLE,
    runs: [
      {
        id: allocateModelId(document, 'text-edit'),
        styleId: FOOTNOTE_REFERENCE_STYLE,
        text: '',
        preservedXmlFragments: [
          `<w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE_STYLE}"/><w:vertAlign w:val="superscript"/></w:rPr>`,
          '<w:footnoteRef/>',
        ],
      },
      {
        id: allocateModelId(document, 'text-edit'),
        text,
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: [
      `<w:pPr><w:pStyle w:val="${FOOTNOTE_TEXT_STYLE}"/></w:pPr>`,
    ],
  }
}

function nextFootnoteId(
  stories: readonly DocumentStoryWire[],
  overlay: XmlOverlay,
) {
  let next = 1
  const consider = (raw: string | undefined) => {
    const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
    if (Number.isInteger(value) && value >= next) next = value + 1
  }
  const considerXml = (xml: string) => {
    for (const match of xml.matchAll(FOOTNOTE_ID)) {
      consider(match[1] ?? match[2])
    }
  }
  for (const element of parseXmlElements(overlay.source)) {
    if (!isWord(element, 'footnote')) continue
    consider(attributeValue(element, WORD_NAMESPACE, 'id'))
  }
  for (const replacement of overlay.replacements.values()) {
    considerXml(replacement.value)
  }
  for (const story of stories) {
    for (const fragment of story.preservedXmlFragments) considerXml(fragment)
    for (const paragraph of story.paragraphs) {
      for (const run of paragraph.runs) {
        for (const fragment of run.preservedXmlFragments) considerXml(fragment)
      }
    }
  }
  return next
}

export type NoteParagraphOperation = {
  type:
    'insert_paragraph_after' | 'insert_paragraph_before' | 'delete_paragraph'
  paragraph: ParagraphAnchor
}

export function assertNoteStoriesKeepParagraph(
  document: OoxmlDocument,
  operations: readonly NoteParagraphOperation[],
) {
  const noteParts = new Set(
    document.model.stories
      .filter(
        (story) => story.kind === 'footnotes' || story.kind === 'endnotes',
      )
      .map((story) => story.partName),
  )
  if (noteParts.size === 0) return
  const byPart = new Map<string, NoteParagraphOperation[]>()
  for (const operation of operations) {
    if (!noteParts.has(operation.paragraph.partName)) continue
    const list = byPart.get(operation.paragraph.partName) ?? []
    list.push(operation)
    byPart.set(operation.paragraph.partName, list)
  }
  for (const [partName, partOperations] of byPart) {
    const part = requireEditablePart(document, partName)
    const elements = parseXmlElements(part.overlay.source)
    const anchors = [...document.paragraphAnchors.values()].filter(
      (anchor) => anchor.partName === partName,
    )
    for (const element of elements) {
      if (!isWord(element, 'footnote') && !isWord(element, 'endnote')) continue
      const inside = anchors.filter(
        (anchor) =>
          anchor.paragraphRange.start >= element.start &&
          anchor.paragraphRange.end <= element.end,
      )
      let surviving = inside.length
      for (const operation of partOperations) {
        if (!inside.includes(operation.paragraph)) continue
        surviving += operation.type === 'delete_paragraph' ? -1 : 1
      }
      if (surviving < 1) {
        throw new OoxmlError('last-paragraph-required')
      }
    }
  }
}
