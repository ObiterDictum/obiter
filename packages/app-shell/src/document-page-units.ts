export const PX_PER_INCH = 96
const TWIPS_PER_INCH = 1440
const EMU_PER_PX = 9525
const HALF_POINTS_PER_PIXEL = 1.5

export const A4_WIDTH_PX = 794
export const A4_HEIGHT_PX = 1123

export function twipToPx(twips: number): number {
  return (twips * PX_PER_INCH) / TWIPS_PER_INCH
}

export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX
}

export function halfPointToPx(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_PIXEL
}

export function xmlTagAttrs(
  xml: string,
  localName: string,
): string | undefined {
  return xml.match(new RegExp(`<w:${localName}\\b([^>]*)\\/?>`, 'i'))?.[1]
}

export function xmlAttr(
  attrs: string | undefined,
  name: string,
): string | undefined {
  if (!attrs) return undefined
  return attrs.match(new RegExp(`(?:w:)?${name}="([^"]+)"`, 'i'))?.[1]
}

export function xmlNumber(
  attrs: string | undefined,
  name: string,
): number | undefined {
  const value = Number(xmlAttr(attrs, name))
  return Number.isFinite(value) ? value : undefined
}

export function xmlInner(xml: string, localName: string): string | undefined {
  return xml.match(
    new RegExp(`<w:${localName}\\b[^>]*>([\\s\\S]*?)</w:${localName}>`, 'i'),
  )?.[1]
}

/**
 * The first start tag with the given qualified name, isolated from the rest of
 * the fragment. Reading attributes from one short tag avoids the polynomial
 * backtracking of a single regex whose `[^>]*` gaps repeatedly scan a long
 * attribute list looking for a missing `x`/`y`/`cx`/`cy`.
 */
export function xmlStartTag(
  xml: string,
  qualifiedName: string,
): string | undefined {
  return xml.match(new RegExp(`<${qualifiedName}\\b[^>]*>`, 'i'))?.[0]
}

/** A non-negative integer attribute read from an isolated start tag. */
export function xmlDigitAttr(
  tag: string | undefined,
  name: string,
): number | undefined {
  const value = tag?.match(new RegExp(`\\b${name}="(\\d+)"`, 'i'))?.[1]
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
