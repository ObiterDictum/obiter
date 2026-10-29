import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const ALLOWED = [
  /https?:\/\//u,
  /\bLegal:/u,
  /\bSAFETY:/u,
  /SPDX-License-Identifier|\blicen[cs]e\b|\bcopyright\b/iu,
  /^\/\/\/\s*<reference/u,
  /\b(?:eslint|oxlint)-(?:disable|enable)/u,
  /@ts-(?:expect-error|ignore|nocheck)/u,
  /prettier-ignore|@vitest-environment|@jsxImportSource|c8 ignore|istanbul ignore/u,
]

const SKIPPED = [
  /^packages\/database\/migrations\//u,
  /^scripts\/synthetic-v2\//u,
  /\/routeTree\.gen\.ts$/u,
  /\.d\.ts$/u,
]

const files = execFileSync(
  'git',
  ['ls-files', '*.ts', '*.tsx', '*.mts', '*.mjs', '*.js', '*.jsx'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file && !SKIPPED.some((pattern) => pattern.test(file)))

function commentRanges(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const ranges = new Map()
  const add = (found) => {
    for (const range of found ?? []) ranges.set(range.pos, range)
  }
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.pos))
    add(ts.getTrailingCommentRanges(text, node.end))
    if (ts.isJsxExpression(node) && !node.expression)
      add(ts.getLeadingCommentRanges(text, node.pos + 1))
    node.getChildren(source).forEach(visit)
  }
  visit(source)
  return [...ranges.values()]
}

const failures = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const range of commentRanges(file, text)) {
    const comment = text.slice(range.pos, range.end)
    if (ALLOWED.some((pattern) => pattern.test(comment))) continue
    const line = text.slice(0, range.pos).split('\n').length
    failures.push(`${file}:${line}: ${comment.split('\n')[0].slice(0, 100)}`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  console.error(
    `\n${failures.length} comment(s) not allowed. Only upstream-issue URLs, Legal:, SAFETY:, licence headers and tool directives may be comments; put rules in test names (TESTING.md).`,
  )
  process.exit(1)
}
console.log(`comments: ok (${files.length} files)`)
