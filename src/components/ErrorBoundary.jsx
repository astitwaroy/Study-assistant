import { Component } from 'react';

/**
 * Last line of defence. Model output is validated before rendering, so this
 * should never show, but if a render bug slips through the person gets a way
 * out instead of a blank page.
 */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page">
        <div className="panel panel--error" role="alert">
          <h1 className="panel__title">Recall hit a problem it couldn't recover from</h1>
          <p className="panel__hint">Your saved sets are safe. Reload the page to carry on.</p>
          <div className="panel__actions">
            <button type="button" className="button button--primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </main>
    );
  }
}
