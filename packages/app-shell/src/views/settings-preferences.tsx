import { Moon, Sun } from '@obiter/ui/icons'
import { SegmentedControl } from '../segmented-control'
import {
  setShellLayout,
  useShellLayout,
  type ShellLayout,
} from '../shell-layout'
import { setAppTheme, useThemeChoice, type ThemeChoice } from '../use-app-theme'
import { SectionHeading } from './settings-fields'

const THEME_OPTIONS = [
  {
    value: 'light' as const,
    label: 'Light (default)',
    icon: <Sun size={12} aria-hidden />,
  },
  {
    value: 'dark' as const,
    label: 'Dark',
    icon: <Moon size={12} aria-hidden />,
  },
  { value: 'system' as const, label: 'Match system' },
]

const LAYOUT_OPTIONS = [
  { value: 'sidebar' as const, label: 'Sidebar' },
  { value: 'tabs' as const, label: 'Tabs' },
  { value: 'clean' as const, label: 'Clean' },
]

export function PreferencesSection({ active }: { active: boolean }) {
  const choice = useThemeChoice()
  const layout = useShellLayout()

  return (
    <section
      hidden={!active}
      aria-label="Preferences"
      className="flex flex-col gap-6"
    >
      <SectionHeading
        id="settings-appearance-heading"
        level="h3"
        title="Appearance"
        description="Changes apply immediately and are kept on this device."
      />

      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0 max-w-[21rem]">
          <p className="text-meta text-ink">Theme</p>
          <p className="mt-1 text-caption text-subtle">
            Light is the default. Dark suits a dim room, and Match system
            follows the setting on this computer.
          </p>
        </div>
        <SegmentedControl<ThemeChoice>
          label="Theme"
          value={choice}
          options={THEME_OPTIONS}
          onChange={setAppTheme}
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0 max-w-[21rem]">
          <p className="text-meta text-ink">Layout</p>
          <p className="mt-1 text-caption text-subtle">
            Sidebar keeps the module list beside the page, Tabs moves it into
            the title bar, and Clean hides it behind the Obiter mark.
          </p>
        </div>
        <SegmentedControl<ShellLayout>
          label="Layout"
          value={layout}
          options={LAYOUT_OPTIONS}
          onChange={setShellLayout}
        />
      </div>
    </section>
  )
}
