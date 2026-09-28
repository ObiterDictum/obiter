/** Default JSON request body cap (48 KiB). */
export const DEFAULT_JSON_BODY_MAX_BYTES = 49_152

/** Default multipart document upload cap (25 MiB). */
export const DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** Default authenticated search hydration queue depth. */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX = 24

/** Default per-user distinct hydration misses within the window. */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX = 12

/** Default hydration per-user window (10 minutes). */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_WINDOW_MS = 600_000

/**
 * Default legal hydration lease lifetime (5 minutes). It is the ceiling on how
 * long a crashed replica can hold one in-flight slot, and the floor on how
 * long a legitimate operation may run before its lease is reclaimed.
 */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_LEASE_MS = 300_000

/**
 * Default cap on retained per-user hydration windows. The window map is an
 * in-process memory bound, not an identity control: eviction resets the
 * least-recently-seen user's count, so the process-wide Moj rate limiter and
 * `queueMax` remain the hard upstream bound.
 */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_RETAINED_USER_WINDOWS = 4096
