import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHELL_ICONS } from '../src/icon-shell'

const ICONS = [
  'AlignBottom',
  'AlignTop',
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
  'Bookmarks',
  'Browser',
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
  'Columns',
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
  'GridNine',
  'FileDoc',
  'FloppyDisk',
  'FolderOpen',
  'Folders',
  'Hash',
  'GearSix',
  'Highlighter',
  'House',
  'Image',
  'Info',
  'Link',
  'ListBullets',
  'ListChecks',
  'ListDashes',
  'ListNumbers',
  'Lock',
  'MagnifyingGlass',
  'MagnifyingGlassMinus',
  'MagnifyingGlassPlus',
  'Minus',
  'MinusCircle',
  'NotePencil',
  'Moon',
  'PencilSimple',
  'Plus',
  'Question',
  'Ratio',
  'RectangleDashed',
  'Ruler',
  'Scissors',
  'Robot',
  'Scales',
  'ShareNetwork',
  'ShieldCheck',
  'SidebarSimple',
  'SplitVertical',
  'Sun',
  'Swap',
  'Table',
  'TextAa',
  'TextAlignCenter',
  'TextAlignJustify',
  'TextAlignLeft',
  'Tag',
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
  'XCircle',
  'Warning',
  'X',
] as const

const WEIGHTS = ['regular', 'bold', 'fill'] as const

const RATIO_ICON = `import type { IconProps } from '../icon-base'

const STROKE_WIDTH = { regular: 16, bold: 24, fill: 16 } as const

const HEAD =
  'M 58 180 q -14 -14 0 -28 q -14 -14 0 -28 q -14 -14 0 -28 Q 60 40 128 36 Q 196 40 198 96 q 14 14 0 28 q 14 14 0 28 q 14 14 0 28'
const BROW = 'M 76 108 q 13 -16 26 0 q 13 -16 26 0 q 13 -16 26 0 q 13 -16 26 0'
const FACE = 'M 80 114 Q 80 196 128 222 Q 176 196 176 114'
const MARKINGS = 'M 108 122 L 115 162 M 148 122 L 141 162'

export function Ratio({
  size,
  weight = 'regular',
  color = 'currentColor',
  mirrored,
  alt,
  ...rest
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill={color}
      viewBox="0 0 256 256"
      transform={mirrored ? 'scale(-1, 1)' : undefined}
      {...rest}
    >
      {alt ? <title>{alt}</title> : null}
      <g
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH[weight]}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={HEAD} />
        <path d={BROW} />
        <path d={FACE} fill={weight === 'fill' ? color : 'none'} />
        <path d={MARKINGS} />
      </g>
      <ellipse cx="128" cy="190" rx="14" ry="10" fill={color} />
    </svg>
  )
}
`

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
    if (name === 'Ratio') {
      await writeFile(join(outDir, `${name}.tsx`), RATIO_ICON, 'utf8')
      exports.push(`export { ${name} } from './${name}'`)
      continue
    }
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
