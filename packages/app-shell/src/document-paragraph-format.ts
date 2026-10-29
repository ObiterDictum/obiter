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

export const DEFAULT_INDENT_TWIPS = 720

export function lineSpacingPatch(
  value: string,
): { line: number; lineRule: 'auto' } | undefined {
  const option = LINE_SPACING_OPTIONS.find((item) => item.value === value)
  return option ? { line: option.line, lineRule: 'auto' } : undefined
}

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
  return { firstLine: 0, hanging: null }
}

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
  alignment: AlignmentValue | null
  lineSpacing: string
  indent: IndentKind | null
}

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
