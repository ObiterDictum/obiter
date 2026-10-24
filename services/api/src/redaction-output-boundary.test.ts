import { readdir, readFile } from 'node:fs/promises'
import { expect, it } from 'bun:test'
import ts from 'typescript'

it('restricts Redact output OOXML imports to read-only parsing and serialisation', async () => {
  const directory = new URL('./', import.meta.url)
  const files = (await readdir(directory)).filter(
    (file) =>
      /^redaction-.*(?:output|burn).*\.ts$/u.test(file) &&
      !file.includes('.test.'),
  )
  const allowed = new Set([
    'loadOoxmlZipEntries',
    'parseDocx',
    'serialiseDocx',
    'attributeValue',
    'decodeXmlReferences',
    'escapeXmlText',
    'isWord',
    'parseXmlElements',
    'WORD_NAMESPACE',
  ])
  const violations: string[] = []
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(new URL(file, directory), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        !node.moduleSpecifier.text.includes('ooxml')
      )
        continue
      const clause = node.importClause
      if (clause?.isTypeOnly) continue
      const bindings = clause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings) || clause?.name) {
        violations.push(file)
        continue
      }
      for (const item of bindings.elements) {
        if (
          !item.isTypeOnly &&
          !allowed.has((item.propertyName ?? item.name).text)
        )
          violations.push(`${file}: ${item.name.text}`)
      }
    }
  }
  expect(violations).toEqual([])
})
