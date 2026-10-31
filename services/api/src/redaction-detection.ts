import {
  detectHeuristics,
  detectNer,
  loadNerClassifier,
  NER_DEFAULT_CHUNK_TOKENS,
  premask,
  projectMaskedSpan,
  RAMPART_MODEL_ID,
  RAMPART_MODEL_REVISION,
  type Span as RampartSpan,
  type TokenClassifier,
} from '@obiter/rampart-inference'
import {
  mergeSpans,
  normalizePersonDetections,
  reconcileRampartSpans,
  supplementSpans,
  suppressCourtContextSpans,
} from '@obiter/redaction-policy'
import type { DetectionMode } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { defaultRampartCacheDir } from './rampart-cache'
import {
  mergeWindowDetections,
  planDetectionWindows,
  type WindowDetection,
} from './redaction-detection-windows'

const PACKAGE_VERSION = '0.1.3-vendored'

export interface RedactionDetectionConfig {
  model: string
  revision: string
  cacheDir: string
  minScore: number
  chunkTokens: number
}

const DEFAULT_CONFIG: RedactionDetectionConfig = {
  model: RAMPART_MODEL_ID,
  revision: RAMPART_MODEL_REVISION,
  cacheDir: defaultRampartCacheDir(),
  minScore: 0.4,
  chunkTokens: NER_DEFAULT_CHUNK_TOKENS,
}

export interface DetectionResult {
  spans: RedactionSpan[]
  detectorVersion: string
  degraded: boolean
}

export interface DetectorDependencies {
  loadClassifier?: () => Promise<TokenClassifier>
  detectNer?: (
    text: string,
    classifier: TokenClassifier,
    minScore: number,
    chunkTokens: number,
  ) => Promise<RampartSpan[]>
  log?: (message: string, details: Record<string, unknown>) => void
}

export function detectionMode(degraded: boolean): DetectionMode {
  return degraded ? 'heuristics+supplement' : 'model+supplement'
}

function version(model: string, revision: string, mode: DetectionMode) {
  return `rampart-inference@${PACKAGE_VERSION};model=${model}@${revision};supplement@1;reconcile@1;court-context@1;mode=${mode}`
}

function provenance(model: string, revision: string, degraded: boolean) {
  const mode = detectionMode(degraded)
  return {
    detectorVersion: version(model, revision, mode),
    degraded,
  }
}

export type DetectionProgressCallback = (
  completed: number,
  total: number,
) => Promise<void>

export interface RedactionDetector {
  (text: string, progress?: DetectionProgressCallback): Promise<DetectionResult>
  warm: () => Promise<void>
}

export function createRedactionDetector(
  dependencies: DetectorDependencies = {},
  configuration: RedactionDetectionConfig = DEFAULT_CONFIG,
): RedactionDetector {
  let classifier: Promise<TokenClassifier> | undefined
  let inferenceTail: Promise<void> = Promise.resolve()
  const serializeInference = async <T>(operation: () => Promise<T>) => {
    const previous = inferenceTail
    let release: () => void = () => undefined
    inferenceTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
  const load =
    dependencies.loadClassifier ??
    (() =>
      loadNerClassifier({
        model: configuration.model,
        revision: configuration.revision,
        cacheDir: configuration.cacheDir,
        device: 'cpu',
      }))
  const runNer = dependencies.detectNer ?? detectNer
  const log =
    dependencies.log ?? ((message, details) => console.info(message, details))

  const detectWindow = async function detectWindow(
    text: string,
  ): Promise<DetectionResult> {
    const supplement = supplementSpans(text)
    if (!text)
      return {
        spans: supplement,
        ...provenance(configuration.model, configuration.revision, false),
      }
    const started = performance.now()
    const heuristic = detectHeuristics(text)
    let usedClassifier: Promise<TokenClassifier> | undefined
    try {
      usedClassifier = classifier ??= load()
      const loaded = await usedClassifier
      const masked = premask(text, heuristic)
      const model = await serializeInference(() =>
        runNer(
          masked.masked,
          loaded,
          configuration.minScore,
          configuration.chunkTokens,
        ),
      )
      const projected = model.flatMap((span) => {
        const result = projectMaskedSpan(span, text, masked)
        return result ? [result] : []
      })
      const rampart = reconcileRampartSpans(
        text,
        normalizePersonDetections(text, [...heuristic, ...projected]),
      )
      const spans = suppressCourtContextSpans(
        text,
        mergeSpans(rampart, supplement),
      )
      log('redaction_detection_completed', {
        textLength: text.length,
        inferenceMs: Math.round(performance.now() - started),
        model: configuration.model,
        revision: configuration.revision,
      })
      return {
        spans,
        ...provenance(configuration.model, configuration.revision, false),
      }
    } catch (error) {
      if (classifier === usedClassifier) classifier = undefined
      const reason =
        error instanceof Error ? error.message : 'unknown model failure'
      log('redaction_detection_degraded', {
        textLength: text.length,
        model: configuration.model,
        revision: configuration.revision,
        reason,
      })
      const rampart = reconcileRampartSpans(
        text,
        normalizePersonDetections(text, heuristic),
      )
      return {
        spans: suppressCourtContextSpans(text, mergeSpans(rampart, supplement)),
        ...provenance(configuration.model, configuration.revision, true),
      }
    }
  }

  const detectSpans = async function detectSpans(
    text: string,
    progress?: DetectionProgressCallback,
  ): Promise<DetectionResult> {
    const windows = planDetectionWindows(text)
    if (progress) await progress(0, windows.length)
    if (windows.length === 1) {
      const result = await detectWindow(text)
      if (progress) await progress(1, 1)
      return result
    }

    const started = performance.now()
    const detections: WindowDetection[] = []
    const results: DetectionResult[] = []
    for (const window of windows) {
      const result = await detectWindow(text.slice(window.start, window.end))
      results.push(result)
      detections.push({ window, spans: result.spans })
      if (progress) await progress(results.length, windows.length)
    }
    const degraded = results.some((result) => result.degraded)
    log('redaction_detection_completed', {
      textLength: text.length,
      windows: windows.length,
      inferenceMs: Math.round(performance.now() - started),
      model: configuration.model,
      revision: configuration.revision,
      degraded,
    })
    return {
      spans: mergeWindowDetections(detections, text),
      ...provenance(configuration.model, configuration.revision, degraded),
    }
  }

  const warm = async (): Promise<void> => {
    const pending = (classifier ??= load())
    try {
      await pending
    } catch (error) {
      if (classifier === pending) classifier = undefined
      throw error
    }
  }

  return Object.assign(detectSpans, { warm })
}

let configuredDetector: RedactionDetector | undefined

export function configureRedactionDetector(
  configuration: RedactionDetectionConfig,
) {
  configuredDetector = createRedactionDetector({}, configuration)
}

function requireConfiguredDetector(): RedactionDetector {
  if (!configuredDetector) {
    throw new Error('Redaction detector was not configured at API startup.')
  }

  return configuredDetector
}

export function detectRedactionSpans(
  text: string,
  progress?: DetectionProgressCallback,
) {
  return requireConfiguredDetector()(text, progress)
}

export function warmRedactionDetector() {
  return requireConfiguredDetector().warm()
}
