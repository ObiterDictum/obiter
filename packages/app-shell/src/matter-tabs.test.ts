import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import {
  MATTER_TAB_LIMIT,
  closeTab,
  documentTab,
  emptyMatterTabState,
  includeRouteTab,
  matchMatterTabKey,
  matterTabFromPath,
  matterTabPath,
  matterTabStorageKey,
  neighbourTabId,
  openTab,
  overviewTab,
  promoteTab,
  redactTab,
  reopenLastClosed,
  verifyTab,
} from './matter-tabs'
import { parseMatterTabState } from './matter-tab-storage'

function documentIds(tabs: ReturnType<typeof includeRouteTab>) {
  return tabs.map((tab) => tab.id)
}

describe('matter tabs', () => {
  it('maps each matter route to the tab it opens', () => {
    expect(matterTabFromPath('/matters/mtr_1')?.id).toBe('overview')
    expect(matterTabFromPath('/matters/mtr_1/documents/doc_1')?.id).toBe(
      'document:doc_1',
    )
    expect(matterTabFromPath('/matters/mtr_1/verify')?.id).toBe('verify')
    expect(matterTabFromPath('/matters/mtr_1/redact/red_1')?.id).toBe(
      'redact:red_1',
    )
    expect(matterTabFromPath('/matters')).toBeNull()
    expect(matterTabFromPath('/verify')).toBeNull()
  })

  it('builds the path back from a tab', () => {
    expect(matterTabPath('mtr_1', overviewTab())).toBe('/matters/mtr_1')
    expect(matterTabPath('mtr_1', verifyTab())).toBe('/matters/mtr_1/verify')
    expect(matterTabPath('mtr_1', documentTab('doc_1', 'A.docx'))).toBe(
      '/matters/mtr_1/documents/doc_1',
    )
    expect(matterTabPath('mtr_1', redactTab('red_1', 'A.docx'))).toBe(
      '/matters/mtr_1/redact/red_1',
    )
  })

  it('keeps the route tab, pins the overview and never duplicates', () => {
    const overview = overviewTab()
    expect(documentIds(includeRouteTab([], overview))).toEqual(['overview'])
    expect(
      documentIds(includeRouteTab([], documentTab('doc_1', 'A.docx'))),
    ).toEqual(['overview', 'document:doc_1'])
    expect(
      documentIds(includeRouteTab([overview], documentTab('doc_1', 'A.docx'))),
    ).toEqual(['overview', 'document:doc_1'])
    expect(
      documentIds(
        includeRouteTab(
          [overview, documentTab('doc_1', 'A.docx')],
          documentTab('doc_1', 'A.docx'),
        ),
      ),
    ).toEqual(['overview', 'document:doc_1'])
  })

  it('replaces the preview tab on the next single click and promotes on request', () => {
    const opened = openTab(
      [overviewTab()],
      documentTab('doc_1', 'First.docx'),
      { preview: true },
    )
    expect(opened.map((tab) => tab.preview)).toEqual([false, true])

    const replaced = openTab(opened, documentTab('doc_2', 'Second.docx'), {
      preview: true,
    })
    expect(replaced.map((tab) => tab.id)).toEqual([
      'overview',
      'document:doc_2',
    ])
    expect(replaced[1]?.preview).toBe(true)

    const promoted = openTab(replaced, documentTab('doc_2', 'Second.docx'))
    expect(promoted[1]?.preview).toBe(false)
    expect(promoteTab(promoted, 'document:doc_2')[1]?.preview).toBe(false)
  })

  it('keeps a permanent tab permanent when it is clicked again', () => {
    const tabs = openTab([overviewTab()], documentTab('doc_1', 'A.docx'))
    expect(
      openTab(tabs, documentTab('doc_1', 'A.docx'), { preview: true }),
    ).toBe(tabs)
  })

  it('closes the oldest unpinned tab past the limit and keeps the overview', () => {
    let tabs = [overviewTab()]
    for (let index = 0; index < MATTER_TAB_LIMIT + 3; index += 1) {
      tabs = openTab(tabs, documentTab(`doc_${String(index)}`, 'A.docx'))
    }
    expect(tabs).toHaveLength(MATTER_TAB_LIMIT)
    expect(tabs[0]?.id).toBe('overview')
    expect(tabs.some((tab) => tab.id === 'document:doc_0')).toBe(false)
    expect(tabs.at(-1)?.id).toBe(`document:doc_${String(MATTER_TAB_LIMIT + 2)}`)
  })

  it('moves to the neighbour after a close and reopens the last closed tab', () => {
    const tabs = [
      overviewTab(),
      documentTab('doc_1', 'A.docx'),
      documentTab('doc_2', 'B.docx'),
    ]
    expect(neighbourTabId(tabs, 'document:doc_1')).toBe('document:doc_2')
    expect(neighbourTabId(tabs, 'document:doc_2')).toBe('document:doc_1')
    expect(neighbourTabId([overviewTab()], 'overview')).toBeNull()

    const closed = closeTab({ tabs, lastClosed: null }, 'document:doc_1')
    expect(closed.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'document:doc_2',
    ])
    expect(closed.lastClosed?.id).toBe('document:doc_1')

    const reopened = reopenLastClosed(closed)
    expect(reopened.tabs.at(-1)?.id).toBe('document:doc_1')
    expect(reopened.lastClosed).toBeNull()
  })

  it('reads only well-formed stored tabs', () => {
    expect(parseMatterTabState('not json')).toEqual(emptyMatterTabState())
    expect(parseMatterTabState('{"tabs":[{"id":1}]}')).toEqual(
      emptyMatterTabState(),
    )
    const stored = {
      tabs: [overviewTab(), documentTab('doc_1', 'A.docx')],
      lastClosed: null,
    }
    expect(parseMatterTabState(JSON.stringify(stored))).toEqual(stored)
  })

  it('namespaces storage per person and matter', () => {
    expect(matterTabStorageKey('usr_1', 'mtr_1')).not.toBe(
      matterTabStorageKey('usr_2', 'mtr_1'),
    )
    expect(matterTabStorageKey('usr_1', 'mtr_1')).not.toBe(
      matterTabStorageKey('usr_1', 'mtr_2'),
    )
  })
})

describe('matter tab shortcuts', () => {
  const event = {
    key: '2',
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null as EventTarget | null,
  }

  it('selects, closes and reopens tabs on the desktop build', () => {
    expect(
      matchMatterTabKey(event, { platform: 'desktop', tabCount: 3 }),
    ).toEqual({ kind: 'select', index: 1 })
    expect(
      matchMatterTabKey(
        { ...event, key: '9' },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toBeNull()
    expect(
      matchMatterTabKey(
        { ...event, key: 'w' },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toEqual({ kind: 'close' })
    expect(
      matchMatterTabKey(
        { ...event, key: 'T', shiftKey: true },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toEqual({ kind: 'reopen' })
  })

  it('leaves browser-reserved shortcuts to the browser on the web build', () => {
    expect(
      matchMatterTabKey(event, { platform: 'web', tabCount: 3 }),
    ).toBeNull()
    expect(
      matchMatterTabKey(
        { ...event, key: 'w' },
        { platform: 'web', tabCount: 3 },
      ),
    ).toBeNull()
  })

  it('is ignored while typing and when another modifier is held', () => {
    const input = document.createElement('input')
    expect(
      matchMatterTabKey(
        { ...event, target: input },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toBeNull()
    expect(
      matchMatterTabKey(
        { ...event, altKey: true },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toBeNull()
    expect(
      matchMatterTabKey(
        { ...event, defaultPrevented: true },
        { platform: 'desktop', tabCount: 3 },
      ),
    ).toBeNull()
  })
})
