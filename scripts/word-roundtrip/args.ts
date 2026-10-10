/**
 * Command-line shape for the word-roundtrip harness. Flags are whitelisted
 * against KNOWN_FLAGS verbatim so a misspelt flag is ignored rather than
 * silently landing on an Args field.
 */
export type Args = {
  api?: string
  web?: string
  out: string
  dbName?: string
  email?: string
  password?: string
  wordOutput?: string
  wordVersion?: string
}

const KNOWN_FLAGS = new Set([
  'api',
  'web',
  'out',
  'dbName',
  'email',
  'password',
  'wordOutput',
  'wordVersion',
])

export function parseArgs(argv: string[]): Args {
  const args: Args = { out: '/tmp/word-roundtrip' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith('--') || value === undefined) continue
    index += 1
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    if (!KNOWN_FLAGS.has(key)) continue
    // SAFETY: `key` is whitelisted against KNOWN_FLAGS, which names every
    // optional Args property verbatim.
    args[key as keyof Args] = value
  }
  return args
}
