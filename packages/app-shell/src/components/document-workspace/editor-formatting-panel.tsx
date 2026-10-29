import {
  Eraser,
  Highlighter,
  ListChecks,
  ArrowsClockwise,
  TextIndent,
  TextOutdent,
  TextStrikethrough,
  TextSubscript,
  TextSuperscript,
  TreeStructure,
  Swap,
} from '@phosphor-icons/react'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  cn,
} from '@obiter/ui'
import { LINE_SPACING_OPTIONS } from '../../document-paragraph-format'
import { INDENT_OPTIONS } from '../../document-paragraph-format'
import {
  PAGE_SIZE_OPTIONS,
  SECTION_MARGINS_OPTIONS,
} from '../../document-section-format'
import type {
  DocumentFormatToolbar,
  DocumentMarkingsToolbar,
} from './ribbon-types'
import {
  EditorIconButton,
  EditorSelect,
  EditorTextButton,
} from './editor-controls'

const FONT_FACES = [
  'Calibri',
  'Cambria',
  'Times New Roman',
  'Garamond',
  'Georgia',
  'Arial',
  'Courier New',
].map((name) => ({ value: name, label: name }))

// The contract carries a font size in half-points, so the option value is
// twice the point label the user sees.
const FONT_SIZES = [
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '18',
  '20',
  '24',
  '28',
  '36',
].map((size) => ({ value: String(Number(size) * 2), label: size }))

// Hex without the leading `#`, matching the contract's colour pattern.
const FONT_COLOURS = [
  { value: '000000', label: 'Black' },
  { value: 'C00000', label: 'Dark red' },
  { value: 'FF0000', label: 'Red' },
  { value: '0070C0', label: 'Blue' },
  { value: '00B050', label: 'Green' },
]

export const DEFAULT_FONT = { value: '', label: 'Default font' }
export const DEFAULT_SIZE = { value: '', label: 'Default' }
export const DEFAULT_COLOUR = { value: '', label: 'Automatic' }

const MARGIN_OPTIONS = [
  { value: '', label: 'Custom' },
  ...SECTION_MARGINS_OPTIONS,
]
const PAGE_SIZE_SELECT_OPTIONS = [
  { value: '', label: 'Custom' },
  ...PAGE_SIZE_OPTIONS,
]

const DOCUMENT_KINDS = [
  { value: 'advice', label: 'Advice' },
  { value: 'letter', label: 'Letter before action' },
  { value: 'particulars', label: 'Particulars of claim' },
  { value: 'defence', label: 'Defence' },
  { value: 'witness', label: 'Witness statement' },
  { value: 'skeleton', label: 'Skeleton argument' },
  { value: 'order', label: 'Order' },
]

/**
 * The contract's `auto` is an explicit direct colour, not the absent one: the
 * select shows it as Automatic rather than a value no option matches (which
 * renders blank in a browser).
 */
export function fontColourSelectValue(colour: string | null | undefined) {
  return colour === 'auto' ? '' : (colour ?? '')
}

/**
 * The stored kind first: a kind this deployment does not list still shows as
 * itself rather than snapping the select to a value it never chose, and the
 * user can clear it or re-pick without the stored value being lost on sight.
 */
function documentKindOptions(kind: string | null) {
  const options: Array<{ value: string; label: string }> = [
    { value: '', label: 'No type set' },
    ...DOCUMENT_KINDS,
  ]
  if (kind !== null && !options.some((option) => option.value === kind)) {
    options.push({ value: kind, label: kind })
  }
  return options
}

/**
 * The formatting panel the Format menu and the toolbar open: every control
 * that needs a value to choose, which a menu row cannot carry. It is a
 * non-modal popover, so the caret and the selection stay where they were while
 * a font or a margin is picked, and the change still lands on that selection.
 */
export function EditorFormattingPanel({
  open,
  onOpenChange,
  anchor,
  format,
  markings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: HTMLElement | null
  format?: DocumentFormatToolbar
  markings?: DocumentMarkingsToolbar
}) {
  const editing = Boolean(format)
  const emphasis = format?.emphasisUnavailable
  const layoutDisabled = !format || Boolean(format.layoutUnavailable)
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // A value control inside the panel opens its own portaled listbox, so
        // the press that picks an option is reported as an outside press. It
        // is inside this surface in every way that matters: closing here would
        // dismiss the panel at the moment the choice lands.
        if (
          !next &&
          (details.reason === 'outside-press' || details.reason === 'focus-out')
        ) {
          return
        }
        onOpenChange(next)
      }}
    >
      <PopoverPortal>
        <PopoverPositioner anchor={anchor} side="bottom" align="end">
          <PopoverPopup
            aria-label="Font, paragraph and page"
            className="w-[22rem] p-4"
          >
            <div className="flex flex-col gap-4">
              <Section label="Character">
                <Row label="Font">
                  <EditorSelect
                    label="Font"
                    className="w-36"
                    value={format?.fontFamily ?? ''}
                    options={[DEFAULT_FONT, ...FONT_FACES]}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onChange={(value) =>
                      format?.onFontFamily(value === '' ? null : value)
                    }
                  />
                  <EditorSelect
                    label="Font size"
                    className="w-20"
                    value={
                      format?.fontSize === null ||
                      format?.fontSize === undefined
                        ? ''
                        : String(format.fontSize)
                    }
                    options={[DEFAULT_SIZE, ...FONT_SIZES]}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onChange={(value) =>
                      format?.onFontSize(value === '' ? null : Number(value))
                    }
                  />
                </Row>
                <div className="flex flex-wrap items-center gap-1">
                  <EditorIconButton
                    label="Strikethrough"
                    pressed={format?.strikethrough}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onClick={format?.onToggleStrikethrough}
                    icon={<TextStrikethrough size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Highlight"
                    pressed={Boolean(
                      format?.highlight && format.highlight !== 'none',
                    )}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onClick={format?.onToggleHighlight}
                    icon={<Highlighter size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Superscript"
                    pressed={format?.vertAlign === 'superscript'}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onClick={format?.onToggleSuperscript}
                    icon={<TextSuperscript size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Subscript"
                    pressed={format?.vertAlign === 'subscript'}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onClick={format?.onToggleSubscript}
                    icon={<TextSubscript size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Clear formatting"
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onClick={format?.onClearFormatting}
                    icon={<Eraser size={16} aria-hidden />}
                  />
                </div>
                <Row label="Colour">
                  <EditorSelect
                    label="Font colour"
                    className="w-32"
                    value={fontColourSelectValue(format?.colour)}
                    options={[DEFAULT_COLOUR, ...FONT_COLOURS]}
                    disabled={!editing || Boolean(emphasis)}
                    disabledReason={emphasis}
                    onChange={(value) =>
                      format?.onColour(value === '' ? null : value)
                    }
                  />
                </Row>
              </Section>

              <Section label="Paragraph">
                <Row label="Line spacing">
                  <EditorSelect
                    label="Line spacing"
                    className="w-20"
                    value={format?.lineSpacing ?? ''}
                    options={LINE_SPACING_OPTIONS}
                    disabled={!editing}
                    onChange={(value) => format?.onLineSpacing(value)}
                  />
                  <EditorSelect
                    label="Indent"
                    className="w-36"
                    value={format?.indentKind ?? ''}
                    options={INDENT_OPTIONS}
                    disabled={!editing}
                    onChange={(value) => {
                      const option = INDENT_OPTIONS.find(
                        (item) => item.value === value,
                      )
                      if (option) format?.onIndentKind(option.value)
                    }}
                  />
                </Row>
                <div className="flex flex-wrap items-center gap-1">
                  <EditorIconButton
                    label="Multilevel numbering"
                    pressed={format?.listKind === 'multilevel'}
                    disabled={!editing || !format?.canApplyMultilevel}
                    onClick={() => format?.onToggleList('multilevel')}
                    icon={<TreeStructure size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Increase list indent"
                    disabled={!editing || !format?.canIndent}
                    onClick={format?.onIndent}
                    icon={<TextIndent size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Decrease list indent"
                    disabled={!editing || !format?.canOutdent}
                    onClick={format?.onOutdent}
                    icon={<TextOutdent size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Continue list"
                    disabled={!editing || !format?.canContinue}
                    onClick={format?.onContinueList}
                    icon={<ListChecks size={16} aria-hidden />}
                  />
                  <EditorIconButton
                    label="Restart numbering"
                    pressed={format?.listRestarted}
                    disabled={!editing || !format?.canRestart}
                    onClick={format?.onRestartList}
                    icon={<ArrowsClockwise size={16} aria-hidden />}
                  />
                </div>
              </Section>

              <Section label="Page">
                <Row label="Margins">
                  <EditorSelect
                    label="Margins"
                    className="w-28"
                    value={format?.marginsKind ?? ''}
                    options={MARGIN_OPTIONS}
                    disabled={layoutDisabled}
                    disabledReason={format?.layoutUnavailable}
                    onChange={(value) => {
                      const option = SECTION_MARGINS_OPTIONS.find(
                        (item) => item.value === value,
                      )
                      if (option) format?.onMargins(option.value)
                    }}
                  />
                  <EditorSelect
                    label="Page size"
                    className="w-20"
                    value={format?.pageSizeKind ?? ''}
                    options={PAGE_SIZE_SELECT_OPTIONS}
                    disabled={layoutDisabled}
                    disabledReason={format?.layoutUnavailable}
                    onChange={(value) => {
                      const option = PAGE_SIZE_OPTIONS.find(
                        (item) => item.value === value,
                      )
                      if (option) format?.onPageSize(option.value)
                    }}
                  />
                  <EditorIconButton
                    label="Orientation"
                    pressed={format?.orientation === 'landscape'}
                    disabled={layoutDisabled}
                    disabledReason={format?.layoutUnavailable}
                    onClick={() => format?.onOrientation()}
                    icon={<Swap size={16} aria-hidden />}
                  />
                </Row>
              </Section>

              <Section label="Classification">
                <Row label="Document type">
                  <EditorSelect
                    label="Document type"
                    className="w-44"
                    value={markings?.markings.documentKind ?? ''}
                    options={documentKindOptions(
                      markings?.markings.documentKind ?? null,
                    )}
                    disabled={
                      !markings ||
                      markings.pending ||
                      Boolean(markings.unavailable)
                    }
                    disabledReason={markings?.unavailable}
                    onChange={(value) =>
                      markings?.onDocumentKind(value === '' ? null : value)
                    }
                  />
                </Row>
                <div className="flex flex-wrap items-center gap-1">
                  <EditorTextButton
                    label="Draft"
                    pressed={markings?.markings.draft}
                    disabled={
                      !markings ||
                      markings.pending ||
                      Boolean(markings.unavailable)
                    }
                    disabledReason={markings?.unavailable}
                    onClick={markings?.onToggleDraft}
                  />
                  <EditorTextButton
                    label="Privileged"
                    pressed={markings?.markings.privileged}
                    disabled={
                      !markings ||
                      markings.pending ||
                      Boolean(markings.unavailable)
                    }
                    disabledReason={markings?.unavailable}
                    onClick={markings?.onTogglePrivileged}
                  />
                  <EditorTextButton
                    label="Without prejudice"
                    pressed={markings?.markings.withoutPrejudice}
                    disabled={
                      !markings ||
                      markings.pending ||
                      Boolean(markings.unavailable)
                    }
                    disabledReason={markings?.unavailable}
                    onClick={markings?.onToggleWithoutPrejudice}
                  />
                </div>
              </Section>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption text-subtle">{label}</h3>
      {children}
    </section>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2')}>
      <span className="w-16 shrink-0 text-caption text-muted">{label}</span>
      {children}
    </div>
  )
}
