import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'
import { ToastProvider, Toaster, cn } from '@obiter/ui'
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './auth'
import { CommandPaletteProvider } from './command-palette'
import {
  RightSlotPortalProvider,
  type DocumentPanelTab,
} from './right-slot-portal'
import { currentUserQueryOptions } from './current-user'
import { ShellBootLoading, ShellOfflineBanner } from './shell-states'
import type { ShellSection } from './navigation'
import { Sidebar } from './sidebar'
import { SidebarRail } from './sidebar-rail'
import { TitleBar } from './title-bar'
import { contentsPanelName } from './contents-panel'
import { PagePanelProvider } from './page-panel'
import type { RightSlotTabId } from './right-slot'
import { ShellContentsProvider } from './shell-contents'
import { MatterPreviewProvider } from './matter-preview'
import {
  documentIdFromPath,
  matterIdFromPath,
  resolveSection,
} from './navigation'
import {
  SHELL_STORAGE_KEY,
  useStoredFlag,
  useStoredText,
} from './shell-preferences'
import { useShellShortcuts } from './shell-shortcuts'
import { useMediaQuery } from './use-media-query'

const ContentsPanelLazy = lazy(() =>
  import('./contents-panel').then((module) => ({
    default: module.ContentsPanel,
  })),
)

const RightSlotLazy = lazy(() =>
  import('./right-slot').then((module) => ({ default: module.RightSlot })),
)

const MatterTabsPaneLazy = lazy(() =>
  import('./matter-split').then((module) => ({
    default: module.MatterTabsPane,
  })),
)

const NARROW_QUERY = '(max-width: 1023px)'
const BOTTOM_BAR_QUERY = '(max-width: 767px)'

export function AppShellLayout({
  children,
  platform,
  loadedBuild = null,
}: {
  children: ReactNode
  platform: AppPlatform
  loadedBuild?: string | null
}) {
  const { session, isPending } = useAuth()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isAuthRoute =
    currentPath === '/sign-in' ||
    currentPath === '/sign-up' ||
    currentPath.startsWith('/request-access') ||
    currentPath === '/forgot-password' ||
    currentPath === '/reset-password' ||
    currentPath === '/invites/accept'

  let body: ReactNode

  if (isAuthRoute) {
    body = children
  } else if (isPending) {
    body = <ShellBootLoading />
  } else if (!session) {
    body = <Navigate to="/sign-in" />
  } else {
    body = (
      <ShellContentsProvider>
        <ShellFrame platform={platform} loadedBuild={loadedBuild}>
          {children}
        </ShellFrame>
      </ShellContentsProvider>
    )
  }

  return (
    <ToastProvider>
      {body}
      <Toaster />
    </ToastProvider>
  )
}

export function ShellFrame({
  children,
  platform,
  loadedBuild = null,
}: {
  children: ReactNode
  platform: AppPlatform
  loadedBuild?: string | null
}) {
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(pathname)
  const matterId = matterIdFromPath(pathname)
  const home = section === 'home'
  const narrow = useMediaQuery(NARROW_QUERY)
  const bottomBar = useMediaQuery(BOTTOM_BAR_QUERY)
  const navigate = useNavigate()
  const panelToggleRef = useRef<HTMLButtonElement>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredFlag(
    SHELL_STORAGE_KEY.sidebarCollapsed,
  )
  const [contentsHidden, setContentsHidden] = useStoredFlag(
    SHELL_STORAGE_KEY.contentsHidden,
  )
  const [rightSlotOpen, setRightSlotOpen] = useStoredFlag(
    SHELL_STORAGE_KEY.rightSlotOpen,
  )
  const [rightSlotTab, setRightSlotTab] = useStoredText(
    SHELL_STORAGE_KEY.rightSlotTab,
    'agent',
  )
  const [contentsOpen, setContentsOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)

  const rail = bottomBar || sidebarCollapsed
  const contentsVisible =
    !home && !focusMode && (narrow ? contentsOpen : !contentsHidden)
  const contentsExpanded = narrow ? contentsOpen : !contentsHidden
  const panelName = contentsPanelName(section, pathname)

  function toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed)
  }

  function toggleContents() {
    if (!narrow) {
      setContentsHidden(!contentsHidden)
      return
    }
    if (contentsOpen) {
      closeContentsOverlay()
      return
    }
    setContentsOpen(true)
  }

  function closeContentsOverlay() {
    setContentsOpen(false)
    requestAnimationFrame(() => panelToggleRef.current?.focus())
  }

  function leaveFocusMode() {
    setFocusMode(false)
    requestAnimationFrame(() => panelToggleRef.current?.focus())
  }

  function toggleRightSlot() {
    setRightSlotOpen(!rightSlotOpen)
  }

  function showRightSlotTab(tab: DocumentPanelTab | null) {
    if (tab === null) {
      setRightSlotOpen(false)
      return
    }
    setRightSlotTab(tab)
    setRightSlotOpen(true)
    setFocusMode(false)
  }

  useShellShortcuts({
    'toggle-nav': toggleSidebar,
    'toggle-right-slot': toggleRightSlot,
    'focus-mode': () => setFocusMode(!focusMode),
    'go-home': () => void navigate({ to: '/' }),
    'go-matters': () => void navigate({ to: '/matters' }),
    'go-verify': () => void navigate({ to: '/verify' }),
    'go-redact': () => void navigate({ to: '/redact' }),
    'go-search': () => void navigate({ to: '/search' }),
  })

  useEffect(() => {
    if (!focusMode && !contentsOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (focusMode) {
        leaveFocusMode()
        return
      }
      closeContentsOverlay()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusMode, contentsOpen])

  const pagePanel =
    panelName && !focusMode
      ? {
          name: panelName,
          expanded: contentsExpanded,
          overlay: narrow,
          controls: 'app-shell-contents',
          toggle: toggleContents,
          buttonRef: panelToggleRef,
        }
      : null

  return (
    <CommandPaletteProvider
      onToggleNav={() => setSidebarCollapsed(!sidebarCollapsed)}
      onToggleRightSlot={toggleRightSlot}
      onToggleFocusMode={() => setFocusMode(!focusMode)}
    >
      <PagePanelProvider panel={pagePanel}>
        <RightSlotPortalProvider onShow={showRightSlotTab}>
          <div className="flex h-dvh bg-canvas text-ink max-md:flex-col-reverse">
            {focusMode ? null : rail ? (
              <SidebarRail
                isStaff={me?.isStaff}
                platform={platform}
                rightSlotOpen={rightSlotOpen}
                onToggleRightSlot={toggleRightSlot}
                onExpand={toggleSidebar}
              />
            ) : (
              <Sidebar
                isStaff={me?.isStaff}
                orgName={me?.organisation?.name}
                platform={platform}
                rightSlotOpen={rightSlotOpen}
                onToggleRightSlot={toggleRightSlot}
                onCollapse={toggleSidebar}
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <TitleBar
                loadedBuild={loadedBuild}
                platform={platform}
                focusMode={focusMode}
                onExitFocusMode={leaveFocusMode}
                showSearch={rail || focusMode}
              />
              <div className="relative flex min-h-0 flex-1 flex-col-reverse gap-2 pr-2 pb-2 max-md:pb-0 max-md:pl-2 md:flex-row">
                <div
                  id="app-shell-pane"
                  className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-raised"
                >
                  <MatterPreviewProvider>
                    <ShellPane
                      section={section}
                      pathname={pathname}
                      narrow={narrow}
                      contentsVisible={contentsVisible}
                      matterTabs={matterId !== null && me !== undefined}
                      matterId={matterId}
                      userId={me?.user.id ?? ''}
                      platform={platform}
                      compact={bottomBar}
                      onCloseContents={closeContentsOverlay}
                    >
                      {children}
                    </ShellPane>
                  </MatterPreviewProvider>
                </div>
                {rightSlotOpen && !focusMode ? (
                  <div id="app-shell-right-slot" className="contents">
                    <Suspense fallback={null}>
                      <RightSlotLazy
                        pathname={pathname}
                        tab={normaliseTab(rightSlotTab)}
                        onTabChange={setRightSlotTab}
                      />
                    </Suspense>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </RightSlotPortalProvider>
      </PagePanelProvider>
    </CommandPaletteProvider>
  )
}

function ShellPane({
  section,
  pathname,
  narrow,
  contentsVisible,
  matterTabs,
  matterId,
  userId,
  platform,
  compact,
  onCloseContents,
  children,
}: {
  section: ShellSection
  pathname: string
  narrow: boolean
  contentsVisible: boolean
  matterTabs?: boolean
  matterId: string | null
  userId: string
  platform: AppPlatform
  compact: boolean
  onCloseContents: () => void
  children: ReactNode
}) {
  return (
    <>
      {contentsVisible ? (
        <Suspense fallback={null}>
          {narrow ? <ContentsScrim onClose={onCloseContents} /> : null}
          <ContentsPanelLazy
            section={section}
            pathname={pathname}
            overlay={narrow}
            onDismiss={onCloseContents}
          />
        </Suspense>
      ) : null}
      <main
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          documentIdFromPath(pathname) ? null : '@container',
        )}
      >
        <ShellOfflineBanner />
        {matterTabs && matterId ? (
          <Suspense fallback={null}>
            <MatterTabsPaneLazy
              matterId={matterId}
              userId={userId}
              platform={platform}
              compact={compact}
            >
              {children}
            </MatterTabsPaneLazy>
          </Suspense>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        )}
      </main>
    </>
  )
}

function normaliseTab(tab: string): RightSlotTabId {
  return tab === 'comments' || tab === 'checks' || tab === 'history'
    ? tab
    : 'agent'
}

function ContentsScrim({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close contents"
      onClick={onClose}
      className="absolute inset-0 z-20 bg-overlay"
    />
  )
}
