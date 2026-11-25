import type { Ref } from 'react'

export function FindCaseLawNotices({
  readerRef,
}: {
  readerRef?: Ref<HTMLElement>
}) {
  return (
    <aside
      ref={readerRef}
      aria-label="Find Case Law licence notices"
      tabIndex={readerRef ? 0 : undefined}
      className={`space-y-2 rounded-md border border-line bg-fill px-4 py-3 text-meta leading-relaxed text-ink ${readerRef ? 'sticky top-0 z-10 overflow-y-auto @max-pane:space-y-1 @max-pane:px-3 @max-pane:py-2 @max-pane:leading-snug' : ''}`}
    >
      <p className="font-medium">
        This material only partially represents court and tribunal activity.
        Find Case Law does not contain every judgment or decision.
      </p>
      <p>
        Crown copyright material reproduced by permission of The National
        Archives. The contents of the judgment can be used under the Open
        Justice - Licence.
      </p>
    </aside>
  )
}
