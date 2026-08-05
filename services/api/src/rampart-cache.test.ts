import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultRampartCacheDir } from './rampart-cache'

describe('defaultRampartCacheDir', () => {
  it('keeps the model outside node_modules so reinstalls do not discard it', () => {
    expect(defaultRampartCacheDir()).not.toContain('node_modules')
  })

  it('uses the per-user cache directory on macOS and Linux', () => {
    expect(defaultRampartCacheDir({}, 'darwin')).toBe(
      join(homedir(), '.cache', 'obiter', 'rampart-models'),
    )
    expect(
      defaultRampartCacheDir({ XDG_CACHE_HOME: '/var/cache' }, 'linux'),
    ).toBe(join('/var/cache', 'obiter', 'rampart-models'))
  })

  it('uses LocalAppData on Windows', () => {
    expect(
      defaultRampartCacheDir(
        { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
        'win32',
      ),
    ).toBe(join('C:\\Users\\dev\\AppData\\Local', 'Obiter', 'rampart-models'))
    expect(defaultRampartCacheDir({}, 'win32')).toBe(
      join(homedir(), 'AppData', 'Local', 'Obiter', 'rampart-models'),
    )
  })
})
