import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Notice } from './ui/primitives';

/** A lazy chunk that can't be fetched: the app was updated since this tab loaded (old file names are gone), or the network dropped. */
export const isChunkLoadError = (e: unknown): boolean =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(`${e.name} ${e.message}`);

interface Props {
  children: ReactNode;
  /** Names the screen in the message. */
  label?: string;
}

/**
 * Without this, one render error blanks the whole page. It wraps a screen (keyed by it, so moving to another one starts fresh),
 * leaves the header and navigation working, and never touches saved data: teams and matches live in the stores, not here.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: unknown) {
    // Name only: a message could hold a pasted team or a path.
    console.error('screen crashed', error instanceof Error ? error.name : typeof error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div className="mx-auto max-w-xl py-10">
        <Notice tone="bad" icon={AlertTriangle} title={stale ? 'This screen needs a newer version of the app' : `${this.props.label ?? 'This screen'} hit a problem`}>
          <p>{stale ? 'The app was updated while this tab was open, or the connection dropped. Reload to get the new version.' : 'Your teams and matches are saved and untouched. Try again, or reload the app.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!stale && <Button onClick={() => this.setState({ error: null })}>Try again</Button>}
            <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </Notice>
      </div>
    );
  }
}
