import { Moon, Sun } from '@phosphor-icons/react'
import { SegmentedControl } from '../segmented-control'
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

export function PreferencesSection({ active }: { active: boolean }) {
  const choice = useThemeChoice()

  return (
    <section
      hidden={!active}
      aria-labelledby="settings-preferences-heading"
      className="flex flex-col gap-6"
    >
      <SectionHeading
        id="settings-preferences-heading"
        title="Preferences"
        description="Changes apply immediately and are kept on this device."
      />

      <h3 className="text-item text-ink">Appearance</h3>

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
    </section>
  )
}
