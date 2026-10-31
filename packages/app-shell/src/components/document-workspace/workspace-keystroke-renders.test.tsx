import '@obiter/test-dom'
import { expect, it, mock } from 'bun:test'
import { fireEvent, screen } from '@testing-library/react'
import { memo, type ReactNode } from 'react'

type Props = Record<string, unknown>
type Component = (props: Props) => ReactNode

const renders = new Map<string, number>()

function count(name: string) {
  renders.set(name, (renders.get(name) ?? 0) + 1)
}

function rendersOf(name: string) {
  return renders.get(name) ?? 0
}

async function instrument(
  path: string,
  exportName: string,
  name: string,
  keyOf?: (props: Props) => string,
) {
  const actual = { ...(await import(path)) }
  const component = actual[exportName] as unknown
  const label = (props: Props) => (keyOf ? `${name}:${keyOf(props)}` : name)
  const render =
    (inner: Component): Component =>
    (props) => {
      count(label(props))
      return inner(props)
    }
  const wrapped =
    typeof component === 'object' &&
    component !== null &&
    (component as { $$typeof?: symbol }).$$typeof === Symbol.for('react.memo')
      ? memo(
          render((component as { type: Component }).type),
          (
            component as {
              compare?: (prev: Props, next: Props) => boolean
            }
          ).compare,
        )
      : render(component as Component)
  mock.module(path, () => ({ ...actual, [exportName]: wrapped }))
}

await instrument(
  './model-paragraph',
  'ModelParagraphInner',
  'paragraph',
  (props) => String((props.paragraph as { id: string }).id),
)
await instrument('./editor-toolbar', 'EditorToolbar', 'EditorToolbar')
await instrument('./editor-menu-bar', 'EditorMenuBar', 'EditorMenuBar')
await instrument(
  './editor-command-palette',
  'EditorCommandPalette',
  'EditorCommandPalette',
)
await instrument(
  './workspace-side-panels',
  'WorkspaceSidePanels',
  'WorkspaceSidePanels',
)
await instrument(
  './docx-workspace-chrome',
  'DocxWorkspaceChrome',
  'DocxWorkspaceChrome',
)
await instrument(
  './document-editor-header',
  'DocxEditorHeader',
  'DocxEditorHeader',
)

const { mountWorkspace, multiParagraphModel, paragraph } =
  await import('./docx-workspace-harness')
const { clickParagraph } = await import('./paragraph-selection-harness')

function bodyModel() {
  return multiParagraphModel(
    Array.from({ length: 6 }, (_, index) =>
      paragraph(`p${index}`, `Paragraph ${index} text`),
    ),
  )
}

function bodyField(): HTMLTextAreaElement {
  const field = screen.getByLabelText('Paragraph text')
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('expected a paragraph editor')
  }
  return field
}

it('typing a character re-renders only the edited paragraph', () => {
  mountWorkspace({ models: { doc_1: bodyModel() } })
  fireEvent.click(screen.getByText('Paragraph 0 text'))
  fireEvent.change(bodyField(), { target: { value: 'Paragraph 0 textX' } })
  renders.clear()

  fireEvent.change(bodyField(), { target: { value: 'Paragraph 0 textXY' } })

  expect(rendersOf('paragraph:p0')).toBe(1)
  expect(rendersOf('paragraph:p1')).toBe(0)
  expect(rendersOf('paragraph:p5')).toBe(0)
})

it('typing a character does not re-render the toolbar, palette, menu bar or sidebar', () => {
  mountWorkspace({ models: { doc_1: bodyModel() } })
  fireEvent.click(screen.getByText('Paragraph 0 text'))
  fireEvent.change(bodyField(), { target: { value: 'Paragraph 0 textX' } })
  renders.clear()

  fireEvent.change(bodyField(), { target: { value: 'Paragraph 0 textXY' } })

  expect(rendersOf('EditorToolbar')).toBe(0)
  expect(rendersOf('EditorCommandPalette')).toBe(0)
  expect(rendersOf('EditorMenuBar')).toBe(0)
  expect(rendersOf('WorkspaceSidePanels')).toBe(0)
  expect(rendersOf('DocxWorkspaceChrome')).toBe(0)
})

it('the first keystroke re-renders the save indicator and undo availability', () => {
  mountWorkspace({ models: { doc_1: bodyModel() } })
  fireEvent.click(screen.getByText('Paragraph 0 text'))
  renders.clear()

  fireEvent.change(bodyField(), { target: { value: 'Paragraph 0 textX' } })

  expect(rendersOf('DocxEditorHeader')).toBe(1)
  expect(rendersOf('EditorToolbar')).toBe(1)
  expect(rendersOf('EditorCommandPalette')).toBe(0)
  expect(rendersOf('WorkspaceSidePanels')).toBe(0)
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty(
    'disabled',
    false,
  )
})

it('moving the caret into bold text re-renders the toolbar with bold pressed', () => {
  mountWorkspace({
    models: {
      doc_1: multiParagraphModel([
        paragraph('p1', 'Plain'),
        {
          id: 'p2',
          runs: [
            {
              id: 'p2-r',
              text: 'Bold',
              preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
            },
          ],
          preservedXmlFragments: [],
        },
      ]),
    },
  })
  clickParagraph('p1')
  renders.clear()

  clickParagraph('p2')

  expect(
    screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(rendersOf('EditorToolbar')).toBeGreaterThan(0)
})
