import { Component, type ReactNode } from 'react';

export function RouteLoading() {
  return <div className="route-loading workspace-loading" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><p>Opening your workspace…</p></div>;
}

export default class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="screen screen-active route-error" role="alert"><h2>This screen could not open</h2><p>Reload to try again. Any work you already saved is kept.</p><button className="primary-button" onClick={() => window.location.reload()}>Reload CampusRelay</button></section>;
    return this.props.children;
  }
}
