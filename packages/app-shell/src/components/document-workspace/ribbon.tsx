import type { ReactNode } from 'react'
import {
  Badge,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import {
  ArrowCounterClockwise,
  Bookmark,
  CaretDown,
  CaretUp,
  ChatText,
  DownloadSimple,
  FloppyDisk,
  SquareHalf,
  Image,
  ListBullets,
  ListChecks,
  ListNumbers,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  PaintBrush,
  Palette,
  PencilLine,
  Plus,
  Ruler,
  Table,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextUnderline,
  Trash,
} from '@phosphor-icons/react'
import type { DocumentPresence } from '@obiter/contracts'

export type DocumentFormatToolbar = {
  paragraphStyleId: string
  paragraphStyles: ReadonlyArray<{ styleId: string; name: string }>
  bold: boolean
  italic: boolean
  underline: boolean
  canIndent: boolean
  canOutdent: boolean
  canContinue: boolean
  bulletList: boolean
  numberList: boolean
  canToggleLists: boolean
  onParagraphStyle: (styleId: string | null) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onIndent: () => void
  onOutdent: () => void
  onContinueList: () => void
  onToggleBullets: () => void
  onToggleNumbers: () => void
}

export type DocumentFindToolbar = {
  query: string
  matchLabel: string
  onQuery: (query: string) => void
  onNext: () => void
  onPrevious: () => void
}

export type DocumentRibbonProps = {
  dirty: boolean
  saving: boolean
  trackChanges: boolean
  zoom: number
  commentsOpen: boolean
  changesOpen: boolean
  commentCount: number
  changeCount: number
  presence: DocumentPresence[]
  currentUserId?: string
  fontFace?: string
  fontSizePt?: number
  onToggleComments: () => void
  onToggleChanges: () => void
  onToggleTrackChanges: () => void
  onZoom: (next: number) => void
  onExportText: () => void
  onSave: () => void
  onUndo: () => void
  onInsertParagraph: () => void
  onDeleteParagraph: () => void
  canUndo: boolean
  canEdit: boolean
  format?: DocumentFormatToolbar
  find?: DocumentFindToolbar
}

export function DocumentRibbon({
  dirty,
  saving,
  trackChanges,
  zoom,
  commentsOpen,
  changesOpen,
  commentCount,
  changeCount,
  presence,
  currentUserId,
  fontFace,
  fontSizePt,
  onToggleComments,
  onToggleChanges,
  onToggleTrackChanges,
  onZoom,
  onExportText,
  onSave,
  onUndo,
  onInsertParagraph,
  onDeleteParagraph,
  canUndo,
  canEdit,
  format,
  find,
}: DocumentRibbonProps) {
  const others = presence.filter((item) => item.userId !== currentUserId)

  return (
    <Tabs defaultValue="home">
      <div className="flex items-end justify-between gap-4">
        <TabsList className="inline-flex items-end gap-0.5 rounded-none bg-transparent p-0">
          <RibbonTab value="home">Home</RibbonTab>
          <RibbonTab value="insert">Insert</RibbonTab>
          <ReservedTab icon={<PaintBrush size={14} aria-hidden />}>
            Design
          </ReservedTab>
          <RibbonTab value="layout">Layout</RibbonTab>
          <ReservedTab icon={<Bookmark size={14} aria-hidden />}>
            References
          </ReservedTab>
          <RibbonTab value="review">Review</RibbonTab>
          <RibbonTab value="view">View</RibbonTab>
        </TabsList>
        {find ? <FindControls find={find} /> : null}
      </div>
      <TabsContent value="home" className="pt-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          {format ? (
            <>
              <RibbonGroup>
                {format.paragraphStyles.length > 0 ? (
                  <select
                    aria-label="Paragraph style"
                    className="h-8 max-w-40 rounded-md border border-line bg-canvas px-2 text-sm text-ink"
                    value={format.paragraphStyleId}
                    onChange={(event) =>
                      format.onParagraphStyle(
                        event.target.value === '' ? null : event.target.value,
                      )
                    }
                  >
                    <option value="">No direct style</option>
                    {format.paragraphStyles.map((style) => (
                      <option key={style.styleId} value={style.styleId}>
                        {style.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </RibbonGroup>
              <RibbonGroup>
                <DeferredSelect
                  label="Font"
                  value={fontFace ?? 'Default font'}
                />
                <DeferredSelect
                  label="Font size"
                  value={
                    fontSizePt ? `${Math.round(fontSizePt)} pt` : 'Default size'
                  }
                />
                <RibbonButton
                  label="Bold"
                  pressed={format.bold}
                  disabled={!canEdit}
                  onClick={format.onToggleBold}
                  icon={<TextB size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Italic"
                  pressed={format.italic}
                  disabled={!canEdit}
                  onClick={format.onToggleItalic}
                  icon={<TextItalic size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Underline"
                  pressed={format.underline}
                  disabled={!canEdit}
                  onClick={format.onToggleUnderline}
                  icon={<TextUnderline size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Text colour (not available yet)"
                  disabled
                  icon={<Palette size={16} aria-hidden />}
                />
              </RibbonGroup>
              <RibbonGroup>
                <RibbonButton
                  label="Bullets"
                  pressed={format.bulletList}
                  disabled={!canEdit || !format.canToggleLists}
                  onClick={format.onToggleBullets}
                  icon={<ListBullets size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Numbering"
                  pressed={format.numberList}
                  disabled={!canEdit || !format.canToggleLists}
                  onClick={format.onToggleNumbers}
                  icon={<ListNumbers size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Align left (not available yet)"
                  disabled
                  icon={<TextAlignLeft size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Centre (not available yet)"
                  disabled
                  icon={<TextAlignCenter size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Align right (not available yet)"
                  disabled
                  icon={<TextAlignRight size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Justify (not available yet)"
                  disabled
                  icon={<TextAlignJustify size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Increase indent"
                  disabled={!canEdit || !format.canIndent}
                  onClick={format.onIndent}
                  icon={<TextIndent size={16} aria-hidden />}
                />
                <RibbonButton
                  label="Decrease indent"
                  disabled={!canEdit || !format.canOutdent}
                  onClick={format.onOutdent}
                  icon={<TextOutdent size={16} aria-hidden />}
                />
              </RibbonGroup>
            </>
          ) : null}
          <RibbonGroup>
            <RibbonButton
              label="Insert paragraph"
              disabled={!canEdit}
              onClick={onInsertParagraph}
              icon={<Plus size={16} aria-hidden />}
            />
            <RibbonButton
              label="Delete paragraph"
              disabled={!canEdit}
              onClick={onDeleteParagraph}
              icon={<Trash size={16} aria-hidden />}
            />
          </RibbonGroup>
          <RibbonGroup>
            <RibbonButton
              label="Undo"
              disabled={!canUndo}
              onClick={onUndo}
              icon={<ArrowCounterClockwise size={16} aria-hidden />}
            />
            <RibbonButton
              label="Save"
              disabled={!dirty || saving}
              onClick={onSave}
              icon={<FloppyDisk size={16} aria-hidden />}
            />
          </RibbonGroup>
        </div>
      </TabsContent>
      <TabsContent value="insert" className="pt-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <RibbonGroup>
            <RibbonButton
              label="Insert paragraph below"
              disabled={!canEdit}
              onClick={onInsertParagraph}
              icon={<Plus size={16} aria-hidden />}
            />
            <RibbonButton
              label="Insert comment"
              pressed={commentsOpen}
              disabled={!canEdit}
              onClick={onToggleComments}
              icon={<ChatText size={16} aria-hidden />}
            />
          </RibbonGroup>
          <RibbonGroup>
            <RibbonButton
              label="Page break (not available yet)"
              disabled
              icon={<SquareHalf size={16} aria-hidden />}
            />
            <RibbonButton
              label="Insert table (not available yet)"
              disabled
              icon={<Table size={16} aria-hidden />}
            />
            <RibbonButton
              label="Insert image (not available yet)"
              disabled
              icon={<Image size={16} aria-hidden />}
            />
          </RibbonGroup>
        </div>
      </TabsContent>
      <TabsContent value="layout" className="pt-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <RibbonGroup>
            <RibbonButton
              label="Margins (not available yet)"
              disabled
              icon={<Ruler size={16} aria-hidden />}
            />
            <RibbonButton
              label="Page size (not available yet)"
              disabled
              icon={<SquareHalf size={16} aria-hidden />}
            />
          </RibbonGroup>
        </div>
      </TabsContent>
      <TabsContent value="review" className="pt-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <RibbonGroup>
            <RibbonButton
              label={trackChanges ? 'Track changes on' : 'Track changes off'}
              pressed={trackChanges}
              disabled={!canEdit}
              onClick={onToggleTrackChanges}
              icon={<PencilLine size={16} aria-hidden />}
            />
          </RibbonGroup>
          <RibbonGroup>
            <RibbonButton
              label="Comments"
              pressed={commentsOpen}
              onClick={onToggleComments}
              icon={<ChatText size={16} aria-hidden />}
              badge={commentCount}
            />
            <RibbonButton
              label="Tracked changes"
              pressed={changesOpen}
              onClick={onToggleChanges}
              icon={<ListChecks size={16} aria-hidden />}
              badge={changeCount}
            />
          </RibbonGroup>
        </div>
      </TabsContent>
      <TabsContent value="view" className="pt-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <RibbonGroup>
              <RibbonButton
                label="Zoom out"
                onClick={() => onZoom(Math.max(75, zoom - 10))}
                icon={<MagnifyingGlassMinus size={16} aria-hidden />}
              />
              <span className="w-10 text-center font-mono text-xs text-muted">
                {zoom}%
              </span>
              <RibbonButton
                label="Zoom in"
                onClick={() => onZoom(Math.min(140, zoom + 10))}
                icon={<MagnifyingGlassPlus size={16} aria-hidden />}
              />
            </RibbonGroup>
            <RibbonGroup>
              <RibbonButton
                label="Comments panel"
                pressed={commentsOpen}
                onClick={onToggleComments}
                icon={<ChatText size={16} aria-hidden />}
                badge={commentCount}
              />
              <RibbonButton
                label="Changes panel"
                pressed={changesOpen}
                onClick={onToggleChanges}
                icon={<ListChecks size={16} aria-hidden />}
                badge={changeCount}
              />
            </RibbonGroup>
            <RibbonGroup>
              <RibbonButton
                label="Export document"
                onClick={onExportText}
                icon={<DownloadSimple size={16} aria-hidden />}
              />
            </RibbonGroup>
          </div>
          {others.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label="Editors present"
            >
              {others.map((item) => (
                <Badge key={item.userId} tone="info">
                  {shortUserLabel(item.userId)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </TabsContent>
    </Tabs>
  )
}

export function PdfRibbon({
  zoom,
  onZoom,
  onExportText,
}: {
  zoom: number
  onZoom: (next: number) => void
  onExportText: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <RibbonButton
        label="Zoom out"
        onClick={() => onZoom(Math.max(75, zoom - 10))}
        icon={<MagnifyingGlassMinus size={16} aria-hidden />}
      />
      <span className="w-10 text-center font-mono text-xs text-muted">
        {zoom}%
      </span>
      <RibbonButton
        label="Zoom in"
        onClick={() => onZoom(Math.min(140, zoom + 10))}
        icon={<MagnifyingGlassPlus size={16} aria-hidden />}
      />
      <RibbonButton
        label="Export text"
        onClick={onExportText}
        icon={<DownloadSimple size={16} aria-hidden />}
      />
      <span className="pl-2 text-xs text-muted">View only, not editable</span>
    </div>
  )
}

function RibbonTab({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'rounded-none px-3 py-1.5 text-sm font-medium text-muted',
        'border-b-2 border-transparent hover:text-ink',
        'data-[selected]:border-brand data-[selected]:bg-transparent data-[selected]:text-ink',
      )}
    >
      {children}
    </TabsTrigger>
  )
}

function ReservedTab({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 py-1.5 text-sm text-muted/60"
            aria-disabled="true"
          />
        }
      >
        {icon}
        {children}
      </TooltipTrigger>
      <TooltipContent>{`${children} tools are coming soon`}</TooltipContent>
    </Tooltip>
  )
}

function RibbonGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-r border-line pr-2 last:border-r-0 last:pr-0">
      {children}
    </div>
  )
}

function RibbonButton({
  label,
  pressed,
  disabled,
  onClick,
  icon,
  badge,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
  icon: ReactNode
  badge?: number
}) {
  const button = (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size="sm"
      className={cn('px-2', badge != null && badge > 0 && 'gap-1')}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      iconStart={icon}
    >
      {badge != null && badge > 0 ? (
        <span className="font-mono text-[10px] text-muted">{badge}</span>
      ) : null}
    </Button>
  )
  // The span anchor keeps the tooltip alive when the button is disabled, as a
  // disabled button swallows the pointer events the trigger listens for.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function DeferredSelect({ label, value }: { label: string; value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex h-8 cursor-not-allowed items-center" />
        }
      >
        <select
          aria-label={label}
          disabled
          className="h-8 max-w-32 rounded-md border border-line bg-canvas px-2 text-sm text-muted"
          value={value}
        >
          <option value={value}>{value}</option>
        </select>
      </TooltipTrigger>
      <TooltipContent>{`${label} choice is not available yet`}</TooltipContent>
    </Tooltip>
  )
}

function FindControls({ find }: { find: DocumentFindToolbar }) {
  return (
    <div className="flex items-center gap-1 pb-1">
      <MagnifyingGlass size={16} className="text-muted" aria-hidden />
      <input
        id="document-find"
        aria-label="Find in document"
        className="h-8 w-36 rounded-md border border-line bg-surface px-2 text-sm text-ink"
        value={find.query}
        onChange={(event) => find.onQuery(event.target.value)}
      />
      <span className="font-mono text-xs text-muted">{find.matchLabel}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous match"
        onClick={find.onPrevious}
        iconStart={<CaretUp size={16} aria-hidden />}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Next match"
        onClick={find.onNext}
        iconStart={<CaretDown size={16} aria-hidden />}
      />
    </div>
  )
}

function shortUserLabel(userId: string) {
  return userId.length <= 10 ? userId : userId.slice(-8)
}
