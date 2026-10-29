import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  toggleParagraphListOnTargets,
  type ListKind,
} from './document-list-toggle'
import {
  continueList,
  emphasisAddress,
  indentList,
  indentationPatch,
  lineSpacingPatch,
  outdentList,
  paragraphFormatState,
  paragraphIndentLeftPx,
  restartList,
  setParagraphFormatDraft,
  setParagraphStyleDraft,
  toggleEmphasisAtAddress,
} from './document-format-edits'
import {
  formatControlState,
  selectedParagraph,
} from './document-format-controls'
import { effectiveParagraph } from './document-model-text'
import {
  sectionFormatState,
  setSectionMarginsDraft,
  setSectionPageSizeDraft,
  toggleSectionOrientation,
  type PageSizeKind,
  type SectionMarginsKind,
} from './document-section-format'
import type {
  AlignmentValue,
  EmphasisPatch,
  FormatDrafts,
  HighlightValue,
} from './document-format-types'
import type { IndentKind } from './document-paragraph-format'
import type { ExtraRuns } from './document-word-edits'

export type ParagraphRange = {
  paragraphId: string
  from: number
  to: number
}

export type FormatTarget =
  | { kind: 'caret'; paragraphId: string; from: number; to: number }
  | { kind: 'selection'; ranges: ReadonlyArray<ParagraphRange> }

const NOTHING_TO_FORMAT = 'Select text to format'

function highlightPressed(value: HighlightValue | null) {
  return value !== null && value !== 'none'
}

function runSpan(
  paragraph: DocumentParagraphWire,
  runId: string,
): { from: number; to: number } | undefined {
  let cursor = 0
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (run.id === runId) return { from: cursor, to: end }
    cursor = end
  }
  return undefined
}

export function documentFormatToolbar(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  setFormat: (update: (current: FormatDrafts) => FormatDrafts) => void,
  target: FormatTarget = {
    kind: 'caret',
    paragraphId: paragraphId ?? '',
    from: 0,
    to: 0,
  },
  trackChanges = false,
  drafts?: Record<string, string>,
  extraRuns: ExtraRuns = {},
) {
  const ranges: ReadonlyArray<ParagraphRange> =
    target.kind === 'selection'
      ? target.ranges
      : [{ paragraphId: target.paragraphId, from: target.from, to: target.to }]
  const emphasis =
    target.kind === 'selection'
      ? ranges.filter((range) => range.from !== range.to)
      : ranges
  const controls = formatControlState(
    model,
    format,
    paragraphId,
    ranges,
    emphasis,
    drafts,
    extraRuns,
  )
  const section = sectionFormatState(model, format.section)
  const nothingSelected = target.kind === 'selection' && emphasis.length === 0
  const toggle = (patch: EmphasisPatch) => {
    if (emphasis.length === 0) return
    setFormat((current) => {
      let next = current
      for (const range of emphasis) {
        const stored = selectedParagraph(model, range.paragraphId)
        if (!stored) continue
        const effective = effectiveParagraph(
          stored,
          drafts,
          extraRuns[range.paragraphId] ?? [],
        )
        const address = emphasisAddress(
          effective,
          0,
          range.from,
          range.to,
          new Set(stored.runs.map((run) => run.id)),
        )
        next = toggleEmphasisAtAddress(next, address, patch)
        if (!('runId' in address)) continue
        const span = runSpan(effective, address.runId)
        if (!span) continue
        const overlapping = next.emphasis.filter(
          (item) =>
            item.paragraphId === range.paragraphId &&
            item.from !== undefined &&
            item.to !== undefined &&
            Math.max(item.from, span.from) < Math.min(item.to, span.to),
        )
        for (const item of overlapping) {
          next = toggleEmphasisAtAddress(
            next,
            {
              paragraphId: range.paragraphId,
              from: Math.max(item.from ?? span.from, span.from),
              to: Math.min(item.to ?? span.to, span.to),
            },
            patch,
          )
        }
      }
      return next
    })
  }
  const forEachParagraph = (
    apply: (current: FormatDrafts, paragraphId: string) => FormatDrafts,
  ) => {
    setFormat((current) =>
      controls.paragraphIds.reduce((next, id) => apply(next, id), current),
    )
  }
  const formatParagraphIds = controls.paragraphIds.filter(
    (id) => id.length > 0 && selectedParagraph(model, id) !== undefined,
  )
  const forEachFormatParagraph = (
    apply: (current: FormatDrafts, paragraphId: string) => FormatDrafts,
  ) => {
    setFormat((current) =>
      formatParagraphIds.reduce((next, id) => apply(next, id), current),
    )
  }
  return {
    ...(nothingSelected ? { emphasisUnavailable: NOTHING_TO_FORMAT } : {}),
    ...(trackChanges
      ? {
          layoutUnavailable: 'Page setup is not recorded as a tracked change',
        }
      : {}),
    paragraphStyleId: controls.paragraphStyleId,
    paragraphStyleMixed: controls.paragraphStyleMixed,
    paragraphStyles: controls.paragraphStyles,
    alignment: controls.alignment,
    lineSpacing: controls.lineSpacing,
    indentKind: controls.indentKind,
    bold: controls.bold,
    italic: controls.italic,
    underline: controls.underline,
    strikethrough: controls.strikethrough,
    fontFamily: controls.fontFamily,
    fontSize: controls.fontSize,
    colour: controls.colour,
    highlight: controls.highlight,
    vertAlign: controls.vertAlign,
    canIndent: controls.canIndent,
    canOutdent: controls.canOutdent,
    canContinue: controls.canContinue,
    canRestart: controls.canRestart,
    listRestarted: controls.listRestarted,
    listKind: controls.listKind,
    canApplyBullet: controls.canApplyBullet,
    canApplyNumber: controls.canApplyNumber,
    canApplyMultilevel: controls.canApplyMultilevel,
    marginsKind: section.marginsKind,
    orientation: section.orientation,
    pageSizeKind: section.pageSizeKind,
    onParagraphStyle: (styleId: string | null) => {
      if (controls.paragraphIds.length === 0) return
      forEachParagraph((current, id) =>
        setParagraphStyleDraft(current, id, styleId),
      )
    },
    onAlignment: (alignment: AlignmentValue) => {
      if (formatParagraphIds.length === 0) return
      forEachFormatParagraph((current, id) =>
        setParagraphFormatDraft(current, id, { alignment }),
      )
    },
    onLineSpacing: (value: string) => {
      const lineSpacing = lineSpacingPatch(value)
      if (!lineSpacing || formatParagraphIds.length === 0) return
      forEachFormatParagraph((current, id) =>
        setParagraphFormatDraft(current, id, { lineSpacing }),
      )
    },
    onIndentKind: (kind: IndentKind) => {
      if (formatParagraphIds.length === 0) return
      forEachFormatParagraph((current, id) => {
        if (
          kind === 'none' &&
          paragraphFormatState(model, current, [id]).indent === 'none'
        ) {
          return current
        }
        return setParagraphFormatDraft(current, id, {
          indentation: indentationPatch(kind, {
            leftPx: paragraphIndentLeftPx(model, current, id),
          }),
        })
      })
    },
    onToggleBold: () => {
      toggle({ bold: !controls.bold })
    },
    onToggleItalic: () => {
      toggle({ italic: !controls.italic })
    },
    onToggleUnderline: () => {
      toggle({ underline: !controls.underline })
    },
    onToggleStrikethrough: () => {
      toggle({ strikethrough: !controls.strikethrough })
    },
    onToggleHighlight: () => {
      toggle({
        highlight: highlightPressed(controls.highlight) ? 'none' : 'yellow',
      })
    },
    onToggleSuperscript: () => {
      toggle({
        vertAlign:
          controls.vertAlign === 'superscript' ? 'baseline' : 'superscript',
      })
    },
    onToggleSubscript: () => {
      toggle({
        vertAlign:
          controls.vertAlign === 'subscript' ? 'baseline' : 'subscript',
      })
    },
    onFontFamily: (fontFamily: string | null) => {
      toggle({ fontFamily })
    },
    onFontSize: (fontSize: number | null) => {
      toggle({ fontSize })
    },
    onColour: (colour: string | null) => {
      toggle({ colour })
    },
    onClearFormatting: () => {
      toggle({
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        vertAlign: null,
        smallCaps: null,
      })
    },
    onIndent: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? indentList(current, model, target) : current
      }),
    onOutdent: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? outdentList(current, model, target) : current
      }),
    onContinueList: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? continueList(current, model, target) : current
      }),
    onRestartList: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? restartList(current, model, target) : current
      }),
    onToggleList: (kind: ListKind) => {
      const targets = controls.paragraphIds.flatMap((id) => {
        const target = selectedParagraph(model, id)
        return target ? [target] : []
      })
      if (targets.length === 0) return
      setFormat((current) =>
        toggleParagraphListOnTargets(current, model, targets, kind),
      )
    },
    onMargins: (kind: SectionMarginsKind) => {
      setFormat((current) => setSectionMarginsDraft(current, kind))
    },
    onOrientation: () => {
      setFormat((current) => toggleSectionOrientation(current, model))
    },
    onPageSize: (kind: PageSizeKind) => {
      setFormat((current) => setSectionPageSizeDraft(current, model, kind))
    },
  }
}
