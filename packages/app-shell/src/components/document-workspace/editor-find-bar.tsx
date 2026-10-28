import { CaretDown, CaretUp, X } from '@phosphor-icons/react'
import { Button } from '@obiter/ui'
import { EditorIconButton, EditorTextButton } from './editor-controls'
import type { DocumentFindToolbar } from './ribbon-types'

/**
 * The find and replace bar. It opens as a row under the toolbar rather than
 * living inside a menu: a field in a menu loses the keystrokes the menu's own
 * typeahead expects, and the document behind it stays the thing being read.
 */
export function EditorFindBar({
  find,
  onClose,
}: {
  find: DocumentFindToolbar
  onClose: () => void
}) {
  const canReplace = find.onReplaceAll !== undefined
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5"
      role="search"
      aria-label="Find and replace"
    >
      <input
        id="document-find"
        type="text"
        value={find.query}
        onChange={(event) => find.onQuery(event.target.value)}
        placeholder="Find"
        aria-label="Find in document"
        className="h-7 w-40 rounded-sm bg-fill px-2 text-caption text-ink placeholder:text-subtle focus:outline-2 focus:outline-offset-1 focus:outline-ring pointer-coarse:h-11"
      />
      <span
        role="status"
        className="min-w-12 text-center text-caption text-muted tabular-nums"
      >
        {find.matchLabel}
      </span>
      <EditorIconButton
        label="Previous match"
        onClick={find.onPrevious}
        icon={<CaretUp size={14} aria-hidden />}
      />
      <EditorIconButton
        label="Next match"
        onClick={find.onNext}
        icon={<CaretDown size={14} aria-hidden />}
      />
      <EditorTextButton
        label="Match case"
        pressed={find.options.matchCase}
        onClick={() => find.onToggleOption('matchCase')}
      />
      <EditorTextButton
        label="Whole word"
        pressed={find.options.wholeWord}
        onClick={() => find.onToggleOption('wholeWord')}
      />
      {canReplace ? (
        <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <input
            type="text"
            value={find.replace}
            onChange={(event) => find.onReplace?.(event.target.value)}
            placeholder="Replace with"
            aria-label="Replace in document"
            className="h-7 w-40 rounded-sm bg-fill px-2 text-caption text-ink placeholder:text-subtle focus:outline-2 focus:outline-offset-1 focus:outline-ring pointer-coarse:h-11"
          />
          <EditorTextButton
            label="Replace"
            disabled={!find.canReplace}
            onClick={find.onReplaceOne}
          />
          <EditorTextButton
            label="Replace all"
            disabled={!find.canReplace}
            onClick={find.onReplaceAll}
          />
        </>
      ) : null}
      <div className="ms-auto">
        <Button
          variant="ghost"
          size="sm"
          className="size-7 px-0 pointer-coarse:size-11"
          aria-label="Close find"
          onClick={onClose}
          iconStart={<X size={14} aria-hidden />}
        />
      </div>
    </div>
  )
}
