/**
 * The References ribbon: authorities, defined terms, cross-references and
 * notes.
 */
import {
  ArrowsClockwise,
  BookOpen,
  CheckCircle,
  Checks,
  ListChecks,
  ListDashes,
  ListMagnifyingGlass,
  Note,
  Scales,
  ShieldCheck,
  TextT,
} from '@phosphor-icons/react'
import { useState } from 'react'
import type { DocumentStructureToolbar, LegalChecksFocus } from './ribbon-types'
import {
  IconButton,
  RibbonSelect,
  ToolbarGroup,
  ToolbarRow,
} from './ribbon-primitives'
import { useVerificationWorkspace } from '../verification/verification-context'
import { InsertCrossReferenceDialog } from './insert-cross-reference-dialog'
import {
  citationStyleSchema,
  type CitationStyle,
} from '../../document-preferences'

export function ReferencesRibbon({
  authoritiesOpen,
  onToggleAuthorities,
  onInsertAuthority,
  citationStyle,
  onCitationStyle,
  legalChecks,
  structure,
}: {
  authoritiesOpen: boolean
  onToggleAuthorities: () => void
  onInsertAuthority: () => void
  /** The persisted citation convention new insertions are written in. */
  citationStyle: CitationStyle
  /** Absent where authority insertion is not offered; the style select
   * is disabled without it. */
  onCitationStyle?: (style: CitationStyle) => void
  /** The checks panel; absent outside an editable workspace. */
  legalChecks?: {
    open: LegalChecksFocus | null
    onOpen: (focus: LegalChecksFocus) => void
  }
  structure?: DocumentStructureToolbar
}) {
  const [crossReferenceOpen, setCrossReferenceOpen] = useState(false)
  const verification = useVerificationWorkspace()
  // The one document-level Verify control owns the action; this entry reveals
  // it. The context exposes one canonical availability, so this entry is never
  // enabled while the dock has no control to reveal, and a disabled entry
  // carries the honest reason on its accessible name.
  const startAvailability = verification?.startAvailability
  const verifyReason =
    startAvailability && !startAvailability.available
      ? startAvailability.reason
      : null
  return (
    <div
      className="flex min-w-0 flex-wrap items-stretch"
      role="toolbar"
      aria-label="References"
    >
      <ToolbarGroup label="Authorities">
        <ToolbarRow>
          <IconButton
            label="Insert authority"
            onClick={onInsertAuthority}
            icon={<Scales size={16} aria-hidden />}
          />
          <IconButton
            label="Verify citations"
            soon={verification ? undefined : true}
            disabled={
              verification ? startAvailability?.available === false : undefined
            }
            disabledReason={verifyReason ?? undefined}
            onClick={() => verification?.revealStart()}
            icon={<ShieldCheck size={16} aria-hidden />}
          />
          <IconButton
            label="List of authorities"
            pressed={authoritiesOpen}
            onClick={onToggleAuthorities}
            icon={<ListDashes size={16} aria-hidden />}
          />
          <IconButton
            label="Table of authorities"
            onClick={structure?.onInsertTableOfAuthorities}
            disabled={
              !structure || Boolean(structure.tableOfAuthoritiesUnavailable)
            }
            disabledReason={structure?.tableOfAuthoritiesUnavailable}
            icon={<Checks size={16} aria-hidden />}
          />
          <IconButton
            label="Update table"
            onClick={structure?.onUpdateTableOfAuthorities}
            disabled={
              !structure ||
              Boolean(structure.tableOfAuthoritiesUpdateUnavailable)
            }
            disabledReason={structure?.tableOfAuthoritiesUpdateUnavailable}
            icon={<ArrowsClockwise size={16} aria-hidden />}
          />
          <RibbonSelect
            label="Citation style"
            className="w-[6.5rem]"
            disabled={!onCitationStyle}
            value={citationStyle}
            options={[
              { value: 'oscola', label: 'OSCOLA' },
              { value: 'house', label: 'House style' },
            ]}
            onChange={(value) => {
              const parsed = citationStyleSchema.safeParse(value)
              if (parsed.success) onCitationStyle?.(parsed.data)
            }}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Defined terms">
        <ToolbarRow>
          <IconButton
            label="Mark defined term"
            disabled={!structure || Boolean(structure.definedTermUnavailable)}
            disabledReason={structure?.definedTermUnavailable}
            onClick={structure?.onMarkDefinedTerm}
            icon={<TextT size={16} aria-hidden />}
          />
          <IconButton
            label="Check defined terms"
            pressed={legalChecks?.open === 'terms'}
            disabled={!legalChecks}
            onClick={() => legalChecks?.onOpen('terms')}
            icon={<ListMagnifyingGlass size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Cross-references">
        <ToolbarRow>
          <IconButton
            label="Insert cross-reference"
            disabled={
              !structure || Boolean(structure.crossReferenceUnavailable)
            }
            disabledReason={structure?.crossReferenceUnavailable}
            onClick={() => setCrossReferenceOpen(true)}
            icon={<BookOpen size={16} aria-hidden />}
          />
          <IconButton
            label="Check cross-references"
            pressed={legalChecks?.open === 'references'}
            disabled={!legalChecks}
            onClick={() => legalChecks?.onOpen('references')}
            icon={<CheckCircle size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <ToolbarGroup label="Notes">
        <ToolbarRow>
          <IconButton
            label={
              structure?.editingStoryKind === 'footnotes'
                ? 'Close footnotes'
                : 'Insert footnote'
            }
            pressed={structure?.editingStoryKind === 'footnotes'}
            disabled={
              !structure ||
              (structure.editingStoryKind !== 'footnotes' &&
                Boolean(structure.footnoteUnavailable))
            }
            disabledReason={structure?.footnoteUnavailable}
            onClick={() => {
              if (structure?.editingStoryKind === 'footnotes') {
                structure.onCloseStory()
              } else {
                structure?.onInsertFootnote()
              }
            }}
            icon={<Note size={16} aria-hidden />}
          />
          <IconButton
            label="Table of contents"
            onClick={structure?.onInsertTableOfContents}
            disabled={
              !structure || Boolean(structure.tableOfContentsUnavailable)
            }
            disabledReason={structure?.tableOfContentsUnavailable}
            icon={<ListChecks size={16} aria-hidden />}
          />
        </ToolbarRow>
      </ToolbarGroup>
      <InsertCrossReferenceDialog
        open={crossReferenceOpen}
        onOpenChange={setCrossReferenceOpen}
        targets={structure?.crossReferenceTargets ?? []}
        onInsert={(targetParagraphId) =>
          structure?.onInsertCrossReference(targetParagraphId) ?? {
            inserted: false,
            reason: 'The document is still loading.',
          }
        }
      />
    </div>
  )
}
