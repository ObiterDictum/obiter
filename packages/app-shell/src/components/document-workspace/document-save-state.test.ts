import { describe, expect, it } from 'bun:test'
import { readOnlySaveState, tabSaveState } from './document-save-state'

const base = {
  versionLabel: 'version 2',
  offline: false,
  remoteChange: false,
}

describe('tabSaveState', () => {
  it('says saved and keeps the version on the tooltip', () => {
    const state = tabSaveState({ ...base, status: 'saved' })
    expect(state.label).toBe('Saved')
    expect(state.detail).toContain('version 2')
  })

  it('keeps every state the save machine can reach', () => {
    expect(tabSaveState({ ...base, status: 'unsaved' }).label).toBe(
      'Unsaved changes',
    )
    expect(tabSaveState({ ...base, status: 'saving' }).label).toBe('Saving…')
    expect(tabSaveState({ ...base, status: 'failed' }).label).toBe(
      'Save failed',
    )
    expect(tabSaveState({ ...base, status: 'stale' })).toEqual({
      label: '',
      detail: '',
      indicator: 'none',
      status: 'stale',
    })
    expect(tabSaveState({ ...base, status: 'blocked' }).label).toBe(
      'Saved, history needs a reload',
    )
  })

  it('marks saved work with nothing to notice', () => {
    expect(tabSaveState({ ...base, status: 'saved' }).indicator).toBe('none')
  })

  it('marks unsaved work with a steady dot and a save in flight with a pulsing one', () => {
    expect(tabSaveState({ ...base, status: 'unsaved' }).indicator).toBe('dot')
    expect(tabSaveState({ ...base, status: 'saving' }).indicator).toBe('saving')
  })

  it('marks a refused save, an offline tab and a newer server version in danger', () => {
    expect(tabSaveState({ ...base, status: 'failed' }).indicator).toBe('danger')
    expect(
      tabSaveState({ ...base, status: 'unsaved', offline: true }).indicator,
    ).toBe('danger')
    expect(
      tabSaveState({ ...base, status: 'unsaved', remoteChange: true })
        .indicator,
    ).toBe('danger')
  })

  it('marks saved work whose history needs a reload in warning', () => {
    expect(tabSaveState({ ...base, status: 'blocked' }).indicator).toBe(
      'warning',
    )
  })

  it('says the changes are not saved while the browser is offline', () => {
    const state = tabSaveState({
      ...base,
      offline: true,
      status: 'unsaved',
    })
    expect(state.label).toBe('Offline · changes not saved')
    expect(state.detail).toContain('version 2')
  })

  it('reports a newer version on the server rather than implying a clean save', () => {
    expect(
      tabSaveState({ ...base, remoteChange: true, status: 'unsaved' }).label,
    ).toBe('Newer version on the server')
  })

  it('leaves a saved tab alone while the browser is offline', () => {
    expect(
      tabSaveState({ ...base, offline: true, status: 'saved' }).label,
    ).toBe('Saved')
  })
})

describe('readOnlySaveState', () => {
  it('names the version the read-only view shows', () => {
    const state = readOnlySaveState('version 3')
    expect(state.label).toBe('Read only')
    expect(state.detail).toContain('version 3')
  })
})
