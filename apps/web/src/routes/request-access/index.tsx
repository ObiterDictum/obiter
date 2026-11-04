import { RequestAccessRouteView } from '@obiter/app-shell'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { botCheckSiteKeyFor } from '../../bot-check'

export const Route = createFileRoute('/request-access/')({
  component: RequestAccessRouteComponent,
})

function RequestAccessRouteComponent() {
  const [siteKey, setSiteKey] = useState<string>()
  useEffect(() => {
    setSiteKey(botCheckSiteKeyFor(window.location.hostname))
  }, [])
  return <RequestAccessRouteView botCheckSiteKey={siteKey} />
}
