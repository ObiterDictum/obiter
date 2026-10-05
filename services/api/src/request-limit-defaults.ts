/** Default JSON request body cap (48 KiB). */
export const DEFAULT_JSON_BODY_MAX_BYTES = 49_152

/**
 * Default request body cap for the two document-edit routes (12 MiB). Edit
 * batches carry base64 rasters the 48 KiB JSON cap cannot hold; every other
 * route keeps the general limit.
 */
export const DEFAULT_DOCUMENT_EDIT_MAX_BYTES = 12 * 1024 * 1024

/** Default multipart document upload cap (25 MiB). */
export const DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** Default authenticated search hydration queue depth. */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_QUEUE_MAX = 24

/** Default per-user distinct hydration misses within the window. */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_PER_CLIENT_MAX = 12

/**
 * Default cluster-wide Find Case Law HTTP attempts allowed across every API
 * replica in the rolling five-minute window. This is an operator assumption,
 * not a verified provider allowance: it preserves the previously used cap as a
 * cluster maximum, so it is at most as permissive as the old per-replica
 * default and never widens upstream traffic. Confirm it against the provider's
 * published allowance before treating it as the production budget.
 */
export const DEFAULT_MOJ_FIND_CASE_LAW_REQUEST_BUDGET = 1000

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
 * least-recently-seen user's count, so the cluster-wide Find Case Law request
 * budget and `queueMax` remain the hard upstream bounds.
 */
export const DEFAULT_LEGAL_SEARCH_HYDRATION_RETAINED_USER_WINDOWS = 4096
