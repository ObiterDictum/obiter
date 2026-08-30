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
