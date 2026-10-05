import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { destinationFor, inlineRuns, type Release } from '@/domain/changelog';
import { Modal } from './ui/Modal';
import { buttonClass } from './ui/styles';
import { LoadingState } from './ui/primitives';

/** One bullet's Markdown (bold, italic, code), as elements. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) =>
        r.kind === 'bold' ? <b key={i}>{r.text}</b> : r.kind === 'italic' ? <i key={i}>{r.text}</i> : r.kind === 'code' ? <code key={i} className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">{r.text}</code> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}

/**
 * "What's new": the CHANGELOG's New / Changed / Fixed bullets, newest release first. After an update it
 * lists what came since the version last seen (`since`); opened by hand, the latest few releases.
 * A bullet whose bold title names a screen gets a "Try it" link to it.
 */
export default function WhatsNew({ open, onOpenChange, since }: { open: boolean; onOpenChange: (o: boolean) => void; since?: string }) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('virtual:changelog').then((m) => alive && setReleases(m.default));
    return () => {
      alive = false;
    };
  }, []);
  const shown = releases && (since ? releases.slice(0, sinceCount(releases, since)) : releases.slice(0, 5));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="What’s new" description={`Pokémon Team Builder v${__APP_VERSION__}`} wide>
      {!shown ? (
        <LoadingState label="Loading…" />
      ) : (
        <div className="space-y-6 text-sm">
          {shown.map((r) => (
            <section key={r.version} aria-label={`Version ${r.version}`} className="space-y-2">
              <h3 className="flex items-baseline gap-2 text-base font-semibold">
                <Sparkles size={15} className="self-center text-accent" aria-hidden />
                {r.version}
                {r.date && <span className="text-xs font-normal text-muted">{r.date}</span>}
              </h3>
              {r.sections.map((s, si) => (
                <div key={si} className="space-y-1">
                  {s.heading && <h4 className="text-xs font-semibold tracking-wider text-muted uppercase">{s.heading}</h4>}
                  <ul className="space-y-1.5">
                    {s.items.map((it, ii) => {
                      const to = destinationFor(it.title);
                      return (
                        <li key={ii} className="leading-relaxed">
                          <Inline text={it.text} />
                          {to && (
                            <>
                              {' '}
                              <a
                                href={to}
                                onClick={() => onOpenChange(false)}
                                className={buttonClass('ghost', 'sm', 'inline-flex align-baseline text-accent')}
                                aria-label={`Try it: ${it.title}`}
                              >
                                Try it →
                              </a>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {shown.length === 0 && <p className="text-muted">Nothing new since your last visit.</p>}
          <p className="text-xs text-muted">Older changes are in CHANGELOG.md in the repository.</p>
        </div>
      )}
    </Modal>
  );
}

/** How many of the (newest-first) releases come after `since`. */
function sinceCount(releases: Release[], since: string): number {
  const at = releases.findIndex((r) => r.version === since);
  return at < 0 ? releases.length : at;
}
