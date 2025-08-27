import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error | null;
  info?: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log the error to console for debugging
    // Could also send to a logging service here
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught error:', error, info);
    this.setState({ info });
  }

  handleReset() {
    if (typeof this.props.onReset === 'function') {
      try {
        this.props.onReset();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ErrorBoundary] onReset handler threw', e);
      }
    }
    this.setState({ hasError: false, error: null, info: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255, 245, 245, 0.9)',
            color: '#991b1b',
            padding: 16,
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          }}
        >
          <div style={{ maxWidth: 720 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {this.state.error?.message || 'An error occurred while rendering this visualization.'}
            </div>
            {this.state.info?.componentStack && (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 11,
                  color: '#7f1d1d',
                  background: '#fff',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  padding: 8,
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {this.state.info.componentStack}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              style={{
                marginTop: 8,
                background: '#991b1b',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 12px',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}