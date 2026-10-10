import type { ReactNode, RefObject } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'

import type { DocumentOutlineEntry } from '../../document-outline'
import type { RulerContext } from '../../document-ruler'
import { VerificationMarkerLayer } from '../verification/verification-marker-layer'
import { DocumentDesk } from './document-page'
import { DocumentRuler } from './document-ruler'
import { DocumentNavigationPane } from './navigation-pane'

/**
 * The document column the desk scrolls: the navigation pane beside it, the
 * ruler above the pages and the side panels after it. `pages` and
 * `sidePanels` arrive rendered because their props run deep into the
 * workspace's caret and review machinery; this component owns only how the
 * desk lays them out and the view state that wraps them (spell-check
 * inheritance, the measured column, the outline row).
 */
export function DocxDesk({
  model,
  navOpen,
  outline,
  activeParagraphId,
  onSelectOutline,
  columnRef,
  spelling,
  rulerOn,
  ruler,
  zoom,
  pages,
  sidePanels,
}: {
  model: DocumentModelWire
  navOpen: boolean
  outline: readonly DocumentOutlineEntry[]
  activeParagraphId: string | null
  onSelectOutline: (paragraphId: string) => void
  columnRef: RefObject<HTMLDivElement | null>
  spelling: boolean
  rulerOn: boolean
  ruler: RulerContext | undefined
  zoom: number
  pages: ReactNode
  sidePanels: ReactNode
}) {
  return (
    <DocumentDesk>
      <div className="flex w-full max-w-full flex-col items-start gap-6 lg:flex-row">
        {navOpen ? (
          <DocumentNavigationPane
            entries={outline}
            activeParagraphId={activeParagraphId}
            onSelect={onSelectOutline}
          />
        ) : null}
        {/* spellCheck on the column container is inherited by the paragraph
            editors, so one toggle governs every field the document mounts. */}
        <div
          ref={columnRef}
          className="flex min-w-0 flex-1 flex-col items-center gap-6"
          spellCheck={spelling}
        >
          {rulerOn && ruler ? (
            <div className="flex w-full justify-center px-4">
              <DocumentRuler
                geometry={ruler.geometry}
                face={ruler.face}
                list={ruler.list}
                zoom={zoom}
              />
            </div>
          ) : null}
          {pages}
        </div>
        {sidePanels}
      </div>
      <VerificationMarkerLayer model={model} />
    </DocumentDesk>
  )
}
