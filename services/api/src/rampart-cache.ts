import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the Rampart model weights are cached between runs.
 *
 * transformers.js defaults its cache to a directory *inside* the installed
 * package (`node_modules/.../@huggingface/transformers/.cache`). Anything that
 * moves or reinstalls that package — a version bump, a store prune, a fresh
 * clone — discards the 14.7 MB download with it. The next redaction then
 * re-fetches the model inline on a user request, and a fetch that fails there
 * leaves the run in `heuristics+supplement` mode: the model is simply absent,
 * which reads as "detection is broken on this machine" rather than as a missing
 * download.
 *
 * Anchoring the cache to a per-user directory outside the workspace makes the
 * download survive installs, so a machine that has run detection once keeps
 * working offline. Deployments override this with `OBITER_RAMPART_CACHE_DIR`
 * pointed at a mounted volume.
 */
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
