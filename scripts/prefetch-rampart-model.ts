/**
 * Download the Rampart detection model into the cache the API will read.
 *
 * Without this, the first redaction on a machine pays for a ~15 MB Hugging Face
 * fetch inline, and a fetch that fails there produces a run in
 * `heuristics+supplement` mode rather than an obvious error. Running this after
 * `bun install` — or in a container build — turns that into a step that either
 * succeeds or fails where someone is looking.
 *
 * Reads the same `OBITER_RAMPART_*` configuration as the API, so a machine that
 * overrides the model, revision or cache directory prefetches what it will use.
 */
// Relative, not a bare workspace name: scripts/ is not a workspace package, and
// bun does not set NODE_PATH the way pnpm did for script execution, so a bare
// '@obiter/*' specifier would not resolve from here.
import { loadNerClassifier } from '../packages/rampart-inference/src/index'
import { readRampartDetectionConfig } from '../services/api/src/env'

async function main() {
  const configuration = readRampartDetectionConfig()
  const context = {
    model: configuration.model,
    revision: configuration.revision,
    cacheDir: configuration.cacheDir,
  }

  console.info('Fetching Rampart model', context)
  const started = Date.now()

  try {
    await loadNerClassifier({ ...context, device: 'cpu' })
  } catch (error) {
    console.error('Rampart model prefetch failed', {
      ...context,
      reason: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
    return
  }

  console.info(`Rampart model cached in ${Date.now() - started}ms`, context)
}

void main()
