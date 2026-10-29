import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultRampartCacheDir(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const base = environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(base, 'Obiter', 'rampart-models')
  }

  const base = environment.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  return join(base, 'obiter', 'rampart-models')
}
