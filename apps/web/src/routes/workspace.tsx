import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Home now lives at the root `/`. This route is kept as a permanent redirect
 * so existing links and bookmarks resolve to the current Home location.
 */
export const Route = createFileRoute('/workspace')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
