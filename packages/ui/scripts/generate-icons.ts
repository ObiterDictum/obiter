import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHELL_ICONS } from '../src/icon-shell'

const ICONS = [
  'ArrowClockwise',
  'ArrowCounterClockwise',
  'ArrowLeft',
  'ArrowRight',
  'ArrowSquareOut',
  'ArrowUpRight',
  'ArrowsClockwise',
  'ArrowsInSimple',
  'ArrowsLeftRight',
  'ArrowsOutSimple',
  'BookOpen',
  'CalendarBlank',
  'CaretDown',
  'CaretLeft',
  'CaretRight',
  'CaretUp',
  'ChatText',
  'Check',
  'CheckCircle',
  'CircleNotch',
  'Clock',
  'Command',
  'CopySimple',
  'DotsThree',
  'DownloadSimple',
  'Eraser',
  'Eye',
  'EyeSlash',
  'FileArrowDown',
  'FileArrowUp',
  'FileText',
  'Flag',
  'FloppyDisk',
  'FolderOpen',
  'Folders',
  'GearSix',
  'Highlighter',
  'House',
  'Image',
  'Info',
  'ListBullets',
  'ListChecks',
  'ListNumbers',
  'Lock',
  'MagnifyingGlass',
  'MagnifyingGlassMinus',
  'MagnifyingGlassPlus',
  'Minus',
  'MinusCircle',
  'Moon',
  'PencilSimple',
  'Plus',
  'Question',
  'Robot',
  'Scales',
  'ShareNetwork',
  'ShieldCheck',
  'Sun',
  'Swap',
  'TextAa',
  'TextAlignCenter',
  'TextAlignJustify',
  'TextAlignLeft',
  'TextAlignRight',
  'TextB',
  'TextIndent',
  'TextItalic',
  'TextOutdent',
  'TextStrikethrough',
  'TextSubscript',
  'TextSuperscript',
  'TextUnderline',
  'Trash',
  'TreeStructure',
  'Upload',
  'UploadSimple',
  'User',
  'Users',
  'Warning',
  'X',
] as const

const WEIGHTS = ['regular', 'bold', 'fill'] as const

interface ReactElement {
  type: unknown
  props: Record<string, unknown>
}

function isElement(value: unknown): value is ReactElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'props' in value
  )
}

function pathData(element: unknown): string {
  if (!isElement(element)) throw new Error('icon weight is not an element')
  if (element.type === 'path') {
    const d = element.props.d
    if (typeof d !== 'string') throw new Error('icon path has no d attribute')
    return d
  }
  const children = element.props.children
  if (Array.isArray(children)) {
    if (children.length !== 1)
      throw new Error('expected a single path per weight')
    return pathData(children[0])
  }
  return pathData(children)
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const outDir = join(scriptDir, '..', 'src', 'icons')
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('@phosphor-icons/react/package.json')
  const defsDir = join(dirname(packageJson), 'dist', 'defs')

  for (const name of SHELL_ICONS) {
    if (!ICONS.includes(name)) throw new Error(`${name} is not a known icon`)
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const exports: string[] = []
  for (const name of ICONS) {
    const module: { default: Map<string, unknown> } = await import(
      join(defsDir, `${name}.es.js`)
    )
    const weights = module.default
    const args = WEIGHTS.map(
      (weight) =>
        `  ${weight}: ${JSON.stringify(pathData(weights.get(weight)))},`,
    )
    const source = [
      "import { createIcon } from '../icon-base'",
      '',
      `export const ${name} = /* @__PURE__ */ createIcon({`,
      ...args,
      '})',
      '',
    ].join('\n')
    await writeFile(join(outDir, `${name}.tsx`), source, 'utf8')
    exports.push(`export { ${name} } from './${name}'`)
  }

  await writeFile(join(outDir, 'index.ts'), `${exports.join('\n')}\n`, 'utf8')
  await writeFile(
    join(outDir, 'shell.ts'),
    `${SHELL_ICONS.map((name) => `export { ${name} } from './${name}'`).join('\n')}\n`,
    'utf8',
  )
  console.log(`wrote ${outDir} (${ICONS.length} icons)`)
}

await main()
