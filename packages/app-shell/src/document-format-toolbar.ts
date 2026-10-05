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

/**
 * What a formatting command acts on. A caret addresses the run it sits in, so
 * a click, a native within-paragraph selection and a selection spanning
 * paragraphs all reach the same controls; a document selection carries one
 * range per paragraph it covers.
 */
export type FormatTarget =
  | { kind: 'caret'; paragraphId: string; from: number; to: number }
  | { kind: 'selection'; ranges: ReadonlyArray<ParagraphRange> }

const NOTHING_TO_FORMAT = 'Select text to format'

/** A highlight is pressed for any colour but an explicit `none`. */
function highlightPressed(value: HighlightValue | null) {
  return value !== null && value !== 'none'
}

/** Where one run starts and ends in the paragraph's own text. */
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
  const nothingSelected = target.kind === 'selection' && emphasis.length === 0
  // A tracked change records a single run, so partial formatting of a range is
  // not representable yet; fail closed rather than dropping the tracking.
  const trackedRange =
    trackChanges && emphasis.some((range) => range.from !== range.to)
  const toggle = (patch: EmphasisPatch) => {
    if (trackedRange || emphasis.length === 0) return
    setFormat((current) => {
      let next = current
      for (const range of emphasis) {
        const stored = selectedParagraph(model, range.paragraphId)
        if (!stored) continue
        // The same effective paragraph the cover reads: stored runs plus a
        // join's appended runs, with text drafts applied. A collapsed caret in
        // an appended run addresses that run's span, because whole-run
        // emphasis by id would name a run the save folds into another one and
        // the paint never overlays.
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
        // Whole-run emphasis lands in the base model, which every pending
        // range paints over afterwards. Restate the same answer over the
        // run's slice of each pending range, behind them, so a range that
        // covers the caret cannot overwrite the click and leave the button
        // stuck. A range partly covering the run is restated over the
        // overlap only; entries carry whole addresses, so the untouched part
        // keeps its own answer.
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
  // Paragraph layout is whole-paragraph, so a caret in no paragraph (an empty
  // id) is not a target; unlike run emphasis it does not need covered text.
  // A pending insert's clientId is not a stored paragraph, so formatting it
  // could only write a draft that never paints and blocks the save; the save
  // plan already excludes a pending insert the same way.
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
    ...(trackedRange
      ? {
          emphasisUnavailable:
            'Partial formatting is not yet recorded as a tracked change',
        }
      : nothingSelected
        ? { emphasisUnavailable: NOTHING_TO_FORMAT }
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
        // None is a special-indent control: it clears only a first-line or
        // hanging indent and keeps any direct left/right indent. When the
        // paragraph has no special indent to clear, restate its draft unchanged
        // so the reference-equal skip in `setFormat` records no history step
        // and the save emits no operation. `paragraphFormatState` reads the
        // pending draft over the stored paragraph, so a draft that already
        // cleared the indent is a no-op too.
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
    // Highlight has many values but one control: it applies a default and the
    // second click releases it. A stored highlight colour reads pressed, so the
    // release is reachable without a colour picker.
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
    // Clear formatting releases every direct character property at once, so
    // the run inherits its style again. It is the same set_run_emphasis
    // mechanism, with each property null rather than a new operation.
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
  }
}
