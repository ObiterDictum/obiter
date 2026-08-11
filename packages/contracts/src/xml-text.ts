export function isValidXmlText(value: string) {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)
    if (codePoint === undefined) return false
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10_000 && codePoint <= 0x10ffff)
    if (!valid) return false
    index += codePoint > 0xffff ? 2 : 1
  }
  return true
}
