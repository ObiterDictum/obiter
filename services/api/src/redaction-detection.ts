import {
  detectHeuristics,
  detectNer,
  mergeSpans as mergeRampartSpans,
  loadNerClassifier,
  premask,
  projectMaskedSpan,
  RAMPART_MODEL_ID,
  RAMPART_MODEL_REVISION,
  type Span as RampartSpan,
  type TokenClassifier,
} from '@obiter/rampart-inference'
import {
  mapRampartSpans,
  mergeSpans,
  supplementSpans,
} from '@obiter/redaction-policy'
import type { DetectionMode } from '@obiter/contracts'
import type { RedactionSpan } from '@obiter/redaction-policy'

const PACKAGE_VERSION = '0.1.3-vendored'

export interface RedactionDetectionConfig {
  model: string
  revision: string
  cacheDir: string | undefined
  minScore: number
  chunkTokens: number
}

const DEFAULT_CONFIG: RedactionDetectionConfig = {
  model: RAMPART_MODEL_ID,
  revision: RAMPART_MODEL_REVISION,
  cacheDir: undefined,
  minScore: 0.4,
  chunkTokens: 400,
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
  return `rampart-inference@${PACKAGE_VERSION};model=${model}@${revision};supplement@1;mode=${mode}`
}

function provenance(model: string, revision: string, degraded: boolean) {
  const mode = detectionMode(degraded)
  return {
    detectorVersion: version(model, revision, mode),
    degraded,
  }
}

export function createRedactionDetector(
  dependencies: DetectorDependencies = {},
  configuration: RedactionDetectionConfig = DEFAULT_CONFIG,
) {
  let classifier: Promise<TokenClassifier> | undefined
  // ONNX sessions are not safe for concurrent inference. This queue is adequate
  // for the current API scale; use per-request sessions or a worker pool to scale.
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

  return async function detectSpans(text: string): Promise<DetectionResult> {
    const supplement = supplementSpans(text)
    if (!text)
      return {
        spans: supplement,
        ...provenance(configuration.model, configuration.revision, false),
      }
    const started = performance.now()
    // Heuristics do not require the model and remain available when it fails.
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
      const rampart = mapRampartSpans({
        text,
        spans: mergeRampartSpans([...heuristic, ...projected]),
      })
      const spans = mergeSpans(rampart, supplement)
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
      // A concurrent request may already have installed a newer load promise.
      if (classifier === usedClassifier) classifier = undefined
      const reason =
        error instanceof Error ? error.message : 'unknown model failure'
      log('redaction_detection_degraded', {
        textLength: text.length,
        model: configuration.model,
        revision: configuration.revision,
        reason,
      })
      const rampart = mapRampartSpans({
        text,
        spans: mergeRampartSpans(heuristic),
      })
      return {
        spans: mergeSpans(rampart, supplement),
        ...provenance(configuration.model, configuration.revision, true),
      }
    }
  }
}

let configuredDetector: ReturnType<typeof createRedactionDetector> | undefined

export function configureRedactionDetector(
  configuration: RedactionDetectionConfig,
) {
  configuredDetector = createRedactionDetector({}, configuration)
}

export function detectRedactionSpans(text: string) {
  if (!configuredDetector) {
    throw new Error('Redaction detector was not configured at API startup.')
  }

  return configuredDetector(text)
}
