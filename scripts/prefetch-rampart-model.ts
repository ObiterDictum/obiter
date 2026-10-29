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
