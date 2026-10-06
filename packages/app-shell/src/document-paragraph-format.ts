import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { formattedParagraphDraft } from './document-format-paint'
import { editableParagraph } from './document-model-text'
import {
  pxToTwip,
  xmlAttr,
  xmlNumber,
  xmlTagAttrs,
} from './document-page-units'
import { paragraphFace, type ParagraphFace } from './document-page-style'
import type {
  AlignmentValue,
  FormatDrafts,
  LineRuleValue,
  ParagraphFormatDraft,
} from './document-format-types'

/**
 * Word's standard line multiples as `line` twips with an `auto` rule. `single`
 * is 240 twips; 1.15, 1.5 and double are proportional. The option value is the
 * ratio the renderer reads back from the same XML, so the select and the paint
 * cannot drift.
 */
export const LINE_SPACING_OPTIONS = [
  { value: '1', label: '1.0', line: 240 },
  { value: '1.15', label: '1.15', line: 276 },
  { value: '1.5', label: '1.5', line: 360 },
  { value: '2', label: '2.0', line: 480 },
] as const

export const INDENT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'first', label: 'First line' },
  { value: 'hanging', label: 'Hanging' },
] as const

export type IndentKind = (typeof INDENT_OPTIONS)[number]['value']

/**
 * Word's default half-inch paragraph indent, the width it applies when a first
 * line or hanging indent is chosen without a custom offset (720 twips = 0.5in).
 */
export const DEFAULT_INDENT_TWIPS = 720

/** The `lineSpacing` value for one line-spacing option, or undefined. */
export function lineSpacingPatch(
  value: string,
): { line: number; lineRule: 'auto' } | undefined {
  const option = LINE_SPACING_OPTIONS.find((item) => item.value === value)
  return option ? { line: option.line, lineRule: 'auto' } : undefined
}

/**
 * The `indentation` value for one indent kind. None clears the special
 * first-line/hanging indent but leaves any direct left/right indentation alone,
 * so it is an instruction that names those two attributes rather than a release
 * of the whole `ind`.
 *
 * Hanging also names `w:left`: OOXML measures `w:hanging` from `w:left`, so
 * without a body indent the first line would outdent into the margin. The body
 * indent is the larger of the paragraph's effective left indent and Word's
 * default half inch; the caller supplies it in px so the face stays the single
 * source of the effective value.
 */
export function indentationPatch(
  kind: IndentKind,
  options?: { leftPx?: number },
): ParagraphFormatDraft['indentation'] {
  if (kind === 'first') return { firstLine: DEFAULT_INDENT_TWIPS }
  if (kind === 'hanging') {
    return {
      left: Math.max(pxToTwip(options?.leftPx ?? 0), DEFAULT_INDENT_TWIPS),
      hanging: DEFAULT_INDENT_TWIPS,
    }
  }
  // Known limitation: this nulls only the direct attributes. `indentKind` reads
  // the merged (style-inclusive) face, so a `firstLine`/`hanging` inherited from
  // the paragraph style still paints First line/Hanging while this click dirties
  // the document without changing what is painted; clearing it would need to
  // name the style's value rather than release the direct one.
  return { firstLine: null, hanging: null }
}

/**
 * The assigned contract fields of one draft, omitting the ones it leaves alone
 * so a later merge does not clear a property this click did not act on, and so
 * the operation always carries at least the one field the control set.
 */
export function paragraphFormatFields(draft: ParagraphFormatDraft) {
  return {
    ...(draft.alignment !== undefined ? { alignment: draft.alignment } : {}),
    ...(draft.lineSpacing !== undefined
      ? { lineSpacing: draft.lineSpacing }
      : {}),
    ...(draft.indentation !== undefined
      ? { indentation: draft.indentation }
      : {}),
  }
}

/**
 * Restates only the named fields on one paragraph's draft. A field absent from
 * `patch` keeps its previous answer, so an align click does not drop a pending
 * indent. `null` is an assignment that releases the field.
 */
export function setParagraphFormatDraft(
  format: FormatDrafts,
  paragraphId: string,
  patch: ParagraphFormatDraft,
): FormatDrafts {
  return {
    ...format,
    paragraphFormats: {
      ...format.paragraphFormats,
      [paragraphId]: { ...format.paragraphFormats[paragraphId], ...patch },
    },
  }
}

export type ParagraphFormatState = {
  /** The alignment every target paragraph agrees on, or null when mixed. */
  alignment: AlignmentValue | null
  /** A line-spacing option value, or '' when mixed or not an option. */
  lineSpacing: string
  /** The indent kind every target agrees on, or null when mixed. */
  indent: IndentKind | null
}

/**
 * The effective paragraph layout over the target paragraphs, read from the
 * painted paragraph so a pending draft is what the controls report. A value the
 * targets do not agree on is null (alignment/indent) or '' (line spacing): a
 * mixed selection presses nothing and one click makes it uniform.
 */
export function paragraphFormatState(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphIds: readonly string[],
): ParagraphFormatState {
  const faces = paragraphIds.flatMap((id) => {
    const stored = editableParagraph(model, id)
    if (!stored) return []
    return [
      faceFormat(
        paragraphFace(formattedParagraphDraft(stored, format), model.styles),
      ),
    ]
  })
  return {
    alignment: uniform(faces.map((face) => face.alignment)),
    lineSpacing: uniform(faces.map((face) => face.lineSpacing)) ?? '',
    indent: uniform(faces.map((face) => face.indent)),
  }
}

/**
 * The effective left indent of one paragraph in px, read from the painted
 * paragraph so a pending draft is what the next control acts on. The hanging
 * indent option needs a body indent to measure `w:hanging` from; an absent
 * paragraph (a pending insert) reports no indent.
 */
export function paragraphIndentLeftPx(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string,
): number {
  const stored = editableParagraph(model, paragraphId)
  if (!stored) return 0
  return (
    paragraphFace(formattedParagraphDraft(stored, format), model.styles)
      .indentLeftPx ?? 0
  )
}

/**
 * The direct paragraph layout one paragraph already carries. The reversal a
 * saved edit is undoing needs the pre-save answer in contract form, including
 * which families were absent (so the release can be explicit).
 *
 * Known limitation (recorded in architecture.html, "Known divergences"): the
 * wire parser drops any paragraph child containing a tracked change, so a
 * `w:pPr` that holds a `w:pPrChange` never reaches `preservedXmlFragments`.
 * Such a paragraph reads here as carrying no direct layout, and a reversal
 * releases properties it actually still has. Numbering shares the blind spot
 * through `paragraphNumPr`; a model-level active-properties fragment is the
 * proper fix and is out of scope for E3.
 */
export function paragraphFormatOf(
  paragraph: DocumentParagraphWire,
): ParagraphFormatDraft {
  const xml =
    paragraph.preservedXmlFragments.find((fragment) =>
      /<w:pPr\b/u.test(fragment),
    ) ?? ''
  const alignment = alignmentFromXml(xmlAttr(xmlTagAttrs(xml, 'jc'), 'val'))
  const spacing = xmlTagAttrs(xml, 'spacing')
  const line = xmlNumber(spacing, 'line')
  const lineRule = lineRuleFromXml(xmlAttr(spacing, 'lineRule'))
  const indentation = indentationFromXml(xmlTagAttrs(xml, 'ind'))
  return {
    ...(alignment !== undefined ? { alignment } : {}),
    ...(line !== undefined
      ? {
          lineSpacing: {
            line,
            ...(lineRule !== undefined ? { lineRule } : {}),
          },
        }
      : {}),
    ...(indentation !== undefined ? { indentation } : {}),
  }
}

function faceFormat(face: ParagraphFace) {
  return {
    alignment: alignmentValue(face.align),
    lineSpacing: lineSpacingValue(face.lineHeight),
    indent: indentKind(face),
  }
}

function indentKind(face: ParagraphFace): IndentKind {
  if (face.indentHangingPx) return 'hanging'
  if (face.indentFirstPx) return 'first'
  return 'none'
}

function alignmentValue(align: ParagraphFace['align']): AlignmentValue {
  if (align === 'center') return 'center'
  if (align === 'right') return 'right'
  if (align === 'justify') return 'both'
  return 'left'
}

function lineSpacingValue(lineHeight: string | undefined): string {
  if (lineHeight === undefined) return ''
  return (
    LINE_SPACING_OPTIONS.find(
      (option) => String(option.line / 240) === lineHeight,
    )?.value ?? ''
  )
}

function alignmentFromXml(
  value: string | undefined,
): AlignmentValue | undefined {
  const jc = value?.toLowerCase()
  if (jc === 'center') return 'center'
  if (jc === 'right' || jc === 'end') return 'right'
  if (jc === 'left' || jc === 'start') return 'left'
  if (jc === 'both' || jc === 'justify' || jc === 'distribute') return 'both'
  return undefined
}

function lineRuleFromXml(value: string | undefined): LineRuleValue | undefined {
  const rule = value?.toLowerCase()
  if (rule === 'auto') return 'auto'
  if (rule === 'exact') return 'exact'
  if (rule === 'atleast') return 'atLeast'
  return undefined
}

function indentationFromXml(
  attrs: string | undefined,
): ParagraphFormatDraft['indentation'] | undefined {
  if (attrs === undefined) return undefined
  const left = xmlNumber(attrs, 'left')
  const right = xmlNumber(attrs, 'right')
  const firstLine = xmlNumber(attrs, 'firstLine')
  const hanging = xmlNumber(attrs, 'hanging')
  if (
    left === undefined &&
    right === undefined &&
    firstLine === undefined &&
    hanging === undefined
  ) {
    return undefined
  }
  return {
    ...(left !== undefined ? { left } : {}),
    ...(right !== undefined ? { right } : {}),
    ...(firstLine !== undefined ? { firstLine } : {}),
    ...(hanging !== undefined ? { hanging } : {}),
  }
}

function uniform<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((value) => value === first) ? (first ?? null) : null
}
