import { readdir, readFile } from 'node:fs/promises'
import { expect, it } from 'bun:test'
import ts from 'typescript'

it('restricts Redact output OOXML imports to read-only parsing and serialisation', async () => {
  const directory = new URL('./', import.meta.url)
  const files = (await readdir(directory)).filter(
    (file) =>
      /^redaction-.*\.ts$/u.test(file) &&
      !file.includes('.test.'),
  )
  expect(files).toContain('redaction-docx-output.ts')
  expect(files).toContain('redaction-docx-burn.ts')
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
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0]
        if (specifier && ts.isStringLiteral(specifier) && specifier.text.includes('ooxml')) violations.push(`${file}: dynamic OOXML import`)
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.includes('ooxml')) {
        if (ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly) return
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause
        if (node.moduleSpecifier.text !== '@obiter/ooxml' || !bindings || ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings) || (ts.isImportDeclaration(node) && node.importClause?.name)) {
          violations.push(file)
        } else {
          for (const item of bindings.elements) {
            if (!item.isTypeOnly && !allowed.has((item.propertyName ?? item.name).text)) violations.push(`${file}: ${item.name.text}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(violations).toEqual([])
})
