import { createLazyFileRoute } from '@tanstack/react-router'
import { AgentWindowView } from '@obiter/app-shell/views/agent-window'
export const Route = createLazyFileRoute('/agent')({
  component: AgentWindowView,
})
