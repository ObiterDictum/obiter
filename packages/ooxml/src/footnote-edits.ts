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
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import { parseXmlElements, type XmlOverlay } from './parts/overlay'
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
} from './structure-xml'

const FOOTNOTE_REFERENCE_STYLE = 'FootnoteReference'
const FOOTNOTE_TEXT_STYLE = 'FootnoteText'
const FOOTNOTE_ID =
  /<w:footnote\b[^>]*\bw:id="(-?\d+)"|<w:footnoteReference\b[^>]*\bw:id="(-?\d+)"/gu

/**
 * Splices a `w:footnoteReference` run at `offset` in the body `paragraph`
 * and appends the matching `w:footnote` entry — the note's own `w:p` carrying
 * `text` — to `word/footnotes.xml`, creating the part, its document
 * relationship and its content-type override when the package has none yet.
 *
 * The reference run carries no `w:t`, so the paragraph's effective text is
 * unchanged and the same `w:p` reparse reads the reference back as the same
 * zero-width run this writes. The note entry always holds exactly one
 * paragraph: the client's per-paragraph `insert_footnote` text is a single
 * block, and the note-body invariant (`assertNoteStoriesKeepParagraph`)
 * then guards that paragraph like a story's last `w:p`.
 */
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
      `<w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE_STYLE}"/></w:rPr>`,
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
    // The reference run is new content, not a split of an existing run —
    // the same null origin the field writers record — and the note
    // paragraph is an insertion whose reversal removes it.
    lineage.recorder.runOrigins.set(referenceWire, [
      { fromRunId: null, fromOffset: 0, toOffset: 0 },
    ])
    recordInsertedParagraph(lineage.recorder, noteWire, lineage.operationIndex)
  }
}

/**
 * The `word/footnotes.xml` part and its story wire, creating the whole
 * package presence when absent: the part itself (with the required
 * `w:id="-1"` separator and `w:id="0"` continuation separator entries), the
 * content-type override and the relationship `word/document.xml` carries to
 * resolve it. An orphaned part — present but never related from the
 * document — is refused rather than guessed at: it could hold entries whose
 * ids the allocator must not recycle.
 */
function ensureFootnotesStory(
  document: OoxmlDocument,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  // The relationship target names the part; `word/footnotes.xml` is only the
  // conventional path, so the story wire — resolved through the document's
  // relationships at parse — is the address, not the name.
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

/**
 * Appended entries are emitted in the conventional `w:`/`w14:` spelling; a
 * part whose root binds either namespace to another prefix — or to none —
 * carries the declaration on each entry so the children still resolve. The
 * created root binds both, so the separator path never needs this.
 */
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

/**
 * The note paragraph's wire, shaped exactly as the reparse yields it: the
 * persisted `para-w14-*` id, the `FootnoteText` style on the paragraph, the
 * `w:footnoteRef` mark run ahead of the note's own text run, and the `w:pPr`
 * as the paragraph's preserved fragment.
 */
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
          `<w:rPr><w:rStyle w:val="${FOOTNOTE_REFERENCE_STYLE}"/></w:rPr>`,
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

/**
 * One more than the highest `w:id` the package still names: the part's
 * `w:footnote` entries — source and pending replacements, since a
 * same-batch entry exists only as a pending value — plus every
 * `w:footnoteReference` the stories' preserved fragments carry, the same
 * rule the fold's `nextPendingFootnoteId` applies. Separator ids are
 * negative or zero, so real notes allocate from 1. The reference scan is
 * load-bearing: a `w:footnote` entry can be removed while a mark naming it
 * survives, and recycling that id would silently re-point the stored mark
 * at the new note.
 */
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

/**
 * The per-entry counterpart of the story-level last-paragraph invariant: a
 * `w:footnote` or `w:endnote` with no `w:p` left is invalid markup, but the
 * per-part count cannot see it — a note part holds many entries. Every
 * anchor inside an entry's element range counts toward it, and a batch may
 * not leave an entry empty. Tracked deletes only wrap their paragraph in
 * markup, so the caller runs this on the untracked path only.
 */
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
