import { describe, expect, it } from 'vitest'
import { workspaceKind } from './document-kind'

describe('workspaceKind', () => {
  it('recognises Word types used on upload and stored versions', () => {
    expect(workspaceKind('docx')).toBe('docx')
    expect(workspaceKind('.docx')).toBe('docx')
    expect(
      workspaceKind(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx')
  })

  it('recognises PDF types', () => {
    expect(workspaceKind('pdf')).toBe('pdf')
    expect(workspaceKind('.pdf')).toBe('pdf')
    expect(workspaceKind('application/pdf')).toBe('pdf')
  })

  it('recognises plain-text types', () => {
    expect(workspaceKind('txt')).toBe('txt')
    expect(workspaceKind('.txt')).toBe('txt')
    expect(workspaceKind('text/plain')).toBe('txt')
    expect(workspaceKind('text/plain; charset=utf-8')).toBe('txt')
  })

  it('treats everything else as other', () => {
    expect(workspaceKind('odt')).toBe('other')
    expect(workspaceKind(undefined)).toBe('other')
  })
})
