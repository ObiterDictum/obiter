import {
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'
import type { HighlightValue, VertAlignValue } from './document-format-types'

/**
 * One interpretation of a run's `w:rPr` flags and values, shared by the paint
 * layer, the control-state reader and the saved-history reader so the toolbar
 * cannot report a state the document does not paint or undo.
 *
 * Two rules keep the reads honest:
 *
 * - A tracked change stores its history in a nested `w:rPrChange/w:rPr`, so the
 *   current properties are read after that subtree is dropped. Reading the
 *   fragments wholesale finds a historical element when the current one is
 *   absent and reports a value the document no longer has.
 * - A flag is off for `0`, `false` and `off`, and an enum value is matched
 *   case-insensitively to the contract's canonical option. Word's own writer
 *   may spell these differently from the contract.
 */

const RUN_PROPERTIES_CHANGE_OPEN = /<([A-Za-z_][\w.-]*):rPrChange\b/u

/**
 * The run properties with any tracked history removed. A tracked change
 * stores a nested historical `w:rPr` under `w:rPrChange`, so the current
 * properties are read after that element is spliced out by its own matching
 * close. A tag-strip regex is lossy (the CodeQL incomplete-sanitization flag)
 * and would stop at a `>` inside an attribute.
 */
export function withoutTrackedRunProperties(xml: string): string {
  let rest = xml
  for (;;) {
    const open = RUN_PROPERTIES_CHANGE_OPEN.exec(rest)
    const prefix = open?.[1]
    if (!prefix) return rest
    const closeAt = rest.indexOf(`</${prefix}:rPrChange`, open.index)
    if (closeAt === -1) return rest
    const closeEnd = rest.indexOf('>', closeAt)
    if (closeEnd === -1) return rest
    rest = `${rest.slice(0, open.index)}${rest.slice(closeEnd + 1)}`
  }
}

function xmlPrefix(xml: string): string {
  return xml.match(/<([A-Za-z_][\w.-]*):/u)?.[1] ?? 'w'
}

function wordAttr(attrs: string | undefined, name: string, prefix: string) {
  return attrs?.match(new RegExp(`(?:${prefix}:)?${name}="([^"]+)"`, 'i'))?.[1]
}

function tagAttrs(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  return xml.match(
    new RegExp(`<${prefix}:${localName}\\b([^>]*)\\/?>`, 'i'),
  )?.[1]
}

function lowercaseValue(
  xml: string,
  prefix: string,
  localName: string,
): string | undefined {
  return wordAttr(
    tagAttrs(xml, prefix, localName),
    'val',
    prefix,
  )?.toLowerCase()
}

function optionOf<T extends string>(
  options: readonly T[],
  value: string | undefined,
): T | null {
  if (!value) return null
  const lower = value.toLowerCase()
  return options.find((option) => option.toLowerCase() === lower) ?? null
}

/** A run flag: `null` when the current `rPr` does not set it. */
export function runFlag(xml: string, localName: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, localName) === undefined) return null
  const value = lowercaseValue(current, prefix, localName)
  return value !== '0' && value !== 'false' && value !== 'off'
}

/** Underline is a value, not a toggle: `none` is the explicit release. */
export function runUnderline(xml: string): boolean | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  if (tagAttrs(current, prefix, 'u') === undefined) return null
  const value = lowercaseValue(current, prefix, 'u')
  return value !== 'none' && value !== '0' && value !== 'false'
}

export function runHighlight(xml: string): HighlightValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditHighlightSchema.options,
    lowercaseValue(current, prefix, 'highlight'),
  )
}

export function runVertAlign(xml: string): VertAlignValue | null {
  const current = withoutTrackedRunProperties(xml)
  const prefix = xmlPrefix(current)
  return optionOf(
    documentEditVertAlignSchema.options,
    lowercaseValue(current, prefix, 'vertAlign'),
  )
}
