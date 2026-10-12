import { Component, type ReactNode } from 'react'
import { reportOne } from '../sync/reportErrors'

/** Shows a way out instead of a blank page, and reports the error. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    reportOne(error.message, error.stack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="shell">
        <div className="warn show" role="alert">
          Something went wrong and the page stopped. Your texts and scores are safe on this device.{' '}
          <button className="link" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
