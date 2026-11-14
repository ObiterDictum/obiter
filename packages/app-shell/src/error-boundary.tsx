import { Component, type ReactNode } from 'react'
import { reportError } from './error-reporting'
export class ErrorReportingBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    reportError(error)
  }
  render() {
    return this.state.failed ? (
      <div role="alert">Something went wrong. Reload Obiter to try again.</div>
    ) : (
      this.props.children
    )
  }
}
