import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'bun:test'
import ts from 'typescript'

it('restricts Redact output OOXML imports to read-only parsing and serialisation', async () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const entries = (await readdir(directory))
    .filter(
      (file) => /^redaction-.*\.ts$/u.test(file) && !file.includes('.test.'),
    )
    .map((file) => resolve(directory, file))
  expect(entries).toContain(resolve(directory, 'redaction-docx-output.ts'))
  expect(entries).toContain(resolve(directory, 'redaction-docx-burn.ts'))
  // The routes that finalize and return Redact output are part of the boundary.
  entries.push(
    resolve(directory, 'routes/redact-review.ts'),
    resolve(directory, 'routes/redact-lifecycle.ts'),
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
    'DEFAULT_OOXML_PACKAGE_LIMITS',
    'OoxmlError',
  ])
  // Configuration constants such as OOXML_MAX_ENTRIES are not edit operations.
  const isAllowed = (name: string) =>
    allowed.has(name) || /^[A-Z][A-Z\d_]+$/u.test(name)
  const violations: string[] = []
  const seen = new Set<string>()
  // Follow local imports so a helper module cannot smuggle in editor edits.
  const queue = [...entries]
  while (queue.length > 0) {
    const path = queue.pop()!
    if (seen.has(path)) continue
    seen.add(path)
    const file = relative(directory, path)
    const source = ts.createSourceFile(
      file,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const specifier = node.arguments[0]
        if (
          specifier &&
          ts.isStringLiteral(specifier) &&
          specifier.text.includes('ooxml')
        )
          violations.push(`${file}: dynamic OOXML import`)
      }
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(path), `${specifier}.ts`)
          if (existsSync(target)) queue.push(target)
        }
        if (!specifier.includes('ooxml')) return
        if (
          ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly
            : node.isTypeOnly
        )
          return
        const bindings = ts.isImportDeclaration(node)
          ? node.importClause?.namedBindings
          : node.exportClause
        if (
          specifier !== '@obiter/ooxml' ||
          !bindings ||
          ts.isNamespaceImport(bindings) ||
          ts.isNamespaceExport(bindings) ||
          (ts.isImportDeclaration(node) && node.importClause?.name)
        ) {
          violations.push(file)
        } else {
          for (const item of bindings.elements) {
            if (
              !item.isTypeOnly &&
              !isAllowed((item.propertyName ?? item.name).text)
            )
              violations.push(`${file}: ${item.name.text}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(seen).toContain(resolve(directory, 'redaction-docx-map.ts'))
  expect(violations).toEqual([])
})
