import type { ReactNode, RefObject } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'

import type { DocumentOutlineEntry } from '../../document-outline'
import type { RulerContext } from '../../document-ruler'
import { VerificationMarkerLayer } from '../verification/verification-marker-layer'
import { DocumentDesk } from './document-page'
import { DocumentRuler } from './document-ruler'
import { DocumentNavigationPane } from './navigation-pane'

/**
 * The document column: the navigation pane beside it, the ruler above the
 * pages and the docked panel after it. `pages` and `sidePanels` arrive rendered
 * because their props run deep into the workspace's caret and review
 * machinery; this component owns only how the desk lays them out and the view
 * state that wraps them (spell-check inheritance, the measured column, the
 * outline row).
 *
 * The pane and the docked panel sit outside the canvas, so each scrolls on its
 * own and the page never drags either out of view. Below `lg` they stack above
 * the desk rather than overlaying it: a reader on a narrow screen keeps the
 * whole sheet readable without a dismiss-first gesture.
 */
export function DocxDesk({
  model,
  navOpen,
  outline,
  activeParagraphId,
  onSelectOutline,
  onCloseNav,
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
  onCloseNav: () => void
  columnRef: RefObject<HTMLDivElement | null>
  spelling: boolean
  rulerOn: boolean
  ruler: RulerContext | undefined
  zoom: number
  pages: ReactNode
  sidePanels: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden lg:flex-row">
      {navOpen ? (
        <div className="max-h-[40vh] shrink-0 overflow-y-auto p-3 lg:max-h-none lg:w-64 lg:border-r lg:border-line lg:p-4">
          <DocumentNavigationPane
            entries={outline}
            activeParagraphId={activeParagraphId}
            onSelect={onSelectOutline}
            onClose={onCloseNav}
          />
        </div>
      ) : null}
      {/* spellCheck on the column container is inherited by the paragraph
          editors, so one toggle governs every field the document mounts. */}
      <DocumentDesk overlay={<VerificationMarkerLayer model={model} />}>
        <div
          ref={columnRef}
          className="flex w-full min-w-0 flex-col items-center gap-6"
          spellCheck={spelling}
        >
          {rulerOn && ruler ? (
            <div className="flex w-full justify-center">
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
      </DocumentDesk>
      {sidePanels}
    </div>
  )
}
