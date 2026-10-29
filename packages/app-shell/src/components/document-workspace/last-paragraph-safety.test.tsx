import '@obiter/test-dom'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { LAST_PARAGRAPH_MESSAGE } from '../../document-edits'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
} from './docx-workspace-harness'
import { commandDisabled, commandReason } from './editor-test-commands'
import { bodyField, clickParagraph } from './paragraph-selection-harness'

function deleteButton() {
  return command('Delete paragraph')
}

const saveButton = () => command('Save')

function renderedParagraphCount(): number {
  return new Set(
    [...document.querySelectorAll('[data-paragraph-id]')].map((node) =>
      node.getAttribute('data-paragraph-id'),
    ),
  ).size
}

function selectedParagraphId(): string | null {
  return (
    document
      .querySelector('[data-paragraph-id][aria-current="true"]')
      ?.getAttribute('data-paragraph-id') ?? null
  )
}

function twoParagraphs() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

describe('last-paragraph deletion safety', () => {
  it('disables Delete paragraph with an accurate reason when one paragraph remains', () => {
    mountWorkspace({})

    const button = deleteButton()
    expect(commandDisabled(button)).toBe(true)
    expect(commandReason(button)).toBe(LAST_PARAGRAPH_MESSAGE)
    expect(saveButton()).toHaveProperty('disabled', true)
  })

  it('leaves the document unchanged when the disabled control is activated', () => {
    mountWorkspace({})
    clickParagraph('p1')

    fireEvent.click(deleteButton())

    expect(renderedParagraphCount()).toBe(1)
    expect(selectedParagraphId()).toBe('p1')
    expect(saveButton()).toHaveProperty('disabled', true)
    expect(command('Undo')).toHaveProperty('disabled', true)
  })

  it('enables Delete paragraph after inserting a paragraph and disables it again on deletion', () => {
    mountWorkspace({})
    clickParagraph('p1')
    expect(commandDisabled(deleteButton())).toBe(true)

    fireEvent.click(command('Insert paragraph'))
    expect(renderedParagraphCount()).toBe(2)
    expect(commandDisabled(deleteButton())).toBe(false)

    fireEvent.click(deleteButton())
    expect(renderedParagraphCount()).toBe(1)
    expect(commandDisabled(deleteButton())).toBe(true)
    expect(saveButton()).toHaveProperty('disabled', true)
  })

  it('deletes one of two paragraphs, marks the document dirty, and restores it on undo', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    expect(commandDisabled(deleteButton())).toBe(false)

    fireEvent.click(deleteButton())

    expect(renderedParagraphCount()).toBe(1)
    expect(selectedParagraphId()).toBe('p1')
    expect(bodyField().value).toBe('Hello')
    expect(document.activeElement).toBe(bodyField())
    expect(commandDisabled(deleteButton())).toBe(true)
    expect(saveButton()).toHaveProperty('disabled', false)

    fireEvent.click(command('Undo'))
    expect(renderedParagraphCount()).toBe(2)
    expect(commandDisabled(deleteButton())).toBe(false)
  })

  it('keeps the second deletion refused after a valid first deletion', () => {
    mountWorkspace({ models: { doc_1: twoParagraphs() } })
    clickParagraph('p2')
    fireEvent.click(deleteButton())

    expect(commandDisabled(deleteButton())).toBe(true)
    expect(commandReason(deleteButton())).toBe(LAST_PARAGRAPH_MESSAGE)
    expect(renderedParagraphCount()).toBe(1)
  })
})
