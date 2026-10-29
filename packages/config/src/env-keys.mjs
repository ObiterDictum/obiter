import { existsSync, readFileSync } from 'node:fs'

export function duplicateEnvKeyMessage(envFile, key) {
  return `${envFile} assigns ${key} more than once. Remove the duplicate: a repeated key is a configuration mistake, and the API and web loaders must agree on every value.`
}

function findClosingQuote(text, from, quote) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === quote) return index
  }
  return -1
}

export function collectEnvKeys(source) {
  const text = source.replace(/\r\n?/g, '\n')
  const keys = []
  let lineStart = 0

  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart)
    if (lineEnd === -1) lineEnd = text.length
    const line = text.slice(lineStart, lineEnd)
    const match = /^[ \t]*(?:export[ \t]+)?([^=]+)=/.exec(line)

    if (match) {
      keys.push(match[1].trim())

      let valueStart = lineStart + match[0].length
      while (text[valueStart] === ' ' || text[valueStart] === '\t') {
        valueStart += 1
      }
      const quote = text[valueStart]
      if (quote === '"' || quote === "'" || quote === '`') {
        const close = findClosingQuote(text, valueStart + 1, quote)
        if (close !== -1) {
          const nextLine = text.indexOf('\n', close)
          lineStart = nextLine === -1 ? text.length + 1 : nextLine + 1
          continue
        }
      }
    }

    lineStart = lineEnd + 1
  }

  return keys
}

export function assertNoDuplicateEnvKeys(envFile) {
  if (!existsSync(envFile)) return

  const seen = new Set()
  for (const key of collectEnvKeys(readFileSync(envFile, 'utf8'))) {
    if (seen.has(key)) throw new Error(duplicateEnvKeyMessage(envFile, key))
    seen.add(key)
  }
}
