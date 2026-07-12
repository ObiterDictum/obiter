import {
  detectHeuristics,
  detectNer,
  mergeSpans as mergeRampartSpans,
  loadNerClassifier,
  premask,
  projectMaskedSpan,
  type Span as RampartSpan,
  type TokenClassifier,
} from '@obiter/rampart-inference'
import {
  mapRampartSpans,
  mergeSpans,
  supplementSpans,
} from '@obiter/redaction-policy'
import type { RedactionSpan } from '@obiter/redaction-policy'

const PACKAGE_VERSION = '0.1.3-vendored'
const DEFAULT_MODEL = 'qarlus/rampart'
const DEFAULT_REVISION = 'c3221c5cd838eb69a249ab40f8b442483865f233'

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
  ) => Promise<RampartSpan[]>
  log?: (message: string, details: Record<string, unknown>) => void
}

function config() {
  return {
    model: process.env.OBITER_RAMPART_MODEL ?? DEFAULT_MODEL,
    revision: process.env.OBITER_RAMPART_REVISION ?? DEFAULT_REVISION,
    cacheDir: process.env.OBITER_RAMPART_CACHE_DIR,
  }
}

function version(model: string, revision: string, degraded: boolean) {
  return `rampart-inference@${PACKAGE_VERSION};model=${model}@${revision};supplement@1;mode=${degraded ? 'heuristics+supplement' : 'model+supplement'}`
}

export function createRedactionDetector(
  dependencies: DetectorDependencies = {},
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
    (() => {
      const options = config()
      return loadNerClassifier({
        model: options.model,
        revision: options.revision,
        cacheDir: options.cacheDir,
        device: 'cpu',
      })
    })
  const runNer = dependencies.detectNer ?? detectNer
  const log =
    dependencies.log ?? ((message, details) => console.info(message, details))

  return async function detectSpans(text: string): Promise<DetectionResult> {
    const supplement = supplementSpans(text)
    const options = config()
    if (!text)
      return {
        spans: supplement,
        detectorVersion: version(options.model, options.revision, false),
        degraded: false,
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
        runNer(masked.masked, loaded),
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
        model: options.model,
        revision: options.revision,
      })
      return {
        spans,
        detectorVersion: version(options.model, options.revision, false),
        degraded: false,
      }
    } catch (error) {
      // A concurrent request may already have installed a newer load promise.
      if (classifier === usedClassifier) classifier = undefined
      const reason =
        error instanceof Error ? error.message : 'unknown model failure'
      log('redaction_detection_degraded', {
        textLength: text.length,
        model: options.model,
        revision: options.revision,
        reason,
      })
      const rampart = mapRampartSpans({
        text,
        spans: mergeRampartSpans(heuristic),
      })
      return {
        spans: mergeSpans(rampart, supplement),
        detectorVersion: version(options.model, options.revision, true),
        degraded: true,
      }
    }
  }
}

export const detectRedactionSpans = createRedactionDetector()
