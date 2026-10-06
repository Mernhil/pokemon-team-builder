import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDex } from '@/data/useDex';
import { getFormat } from '@/domain/formats';
import { PALETTE_TOKEN_NAMES, paletteTokens } from '@/domain/palette';
import { compareVersions, releasesSince } from '@/domain/changelog';
import { usePrefsStore } from '@/store/prefsStore';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { NAV_LABELS, type NavId } from '@/domain/navigation';
import { ignoresHotkeys, nextHotkey } from '@/domain/hotkeys';
import { parseRoute, routeHash } from '@/domain/routes';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { DesktopUpdater } from './components/DesktopUpdater';
import { Toaster } from './components/ui/Toaster';
// Starts remembering where focus was, so a dialog opened later (they load on demand) can give it back.
import './components/ui/returnFocus';
import { LoadingState } from './components/ui/primitives';
import { buttonClass, cn } from './components/ui/styles';

import { Header } from './components/shell/Header';
import { BottomTabs } from './components/shell/Navigation';
import { Builder } from './components/shell/Builder';
// Heavier screens load when first opened.
const DamageCalcView = lazy(() => import('./components/calc/DamageCalcView').then((m) => ({ default: m.DamageCalcView })));
const PokedexView = lazy(() => import('./components/pokedex/PokedexView').then((m) => ({ default: m.PokedexView })));
const AtlasView = lazy(() => import('./components/atlas/AtlasView').then((m) => ({ default: m.AtlasView })));
const MatchesView = lazy(() => import('./components/matches/MatchesView').then((m) => ({ default: m.MatchesView })));
const RegulationDiffView = lazy(() => import('./components/regulation/RegulationDiffView').then((m) => ({ default: m.RegulationDiffView })));
// The palette and the "What's new" sheet load when first opened.
const CommandPalette = lazy(() => import('./components/CommandPalette'));
// Dialogs load the first time they open (they carry the settings, the what's new list), not with the first screen.
const SettingsDialog = lazy(() => import('./components/settings/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const WhatsNew = lazy(() => import('./components/WhatsNew'));
const ShortcutsDialog = lazy(() => import('./components/ShortcutsDialog'));
const GameDayView = lazy(() => import('./components/gameday/GameDayView').then((m) => ({ default: m.GameDayView })));
const AnalyseView = lazy(() => import('./components/analyse/AnalyseView').then((m) => ({ default: m.AnalyseView })));
const ReverseSearchView = lazy(() => import('./components/reverse/ReverseSearchView').then((m) => ({ default: m.ReverseSearchView })));
const MetaView = lazy(() => import('./components/meta/MetaView').then((m) => ({ default: m.MetaView })));

export default function App() {
  const theme = useTeamStore((s) => s.theme);
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const dexState = useDex(format.datasetId);
  const view = useTeamStore((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Set when the sheet opens by itself after an update: the version whose notes were last seen. */
  const [whatsNewSince, setWhatsNewSince] = useState<string>();
  const setLastSeen = usePrefsStore((s) => s.setLastSeenVersion);

  // Ctrl/Cmd+K opens the command palette from anywhere; plain keys (g then a letter, /, ?) when not typing (src/domain/hotkeys.ts).
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (ignoresHotkeys(e.target as HTMLElement | null, !!document.querySelector('[role="dialog"]'))) {
        pendingG = false;
        return;
      }
      const next = nextHotkey(pendingG, e.key);
      pendingG = next.pendingG;
      clearTimeout(timer);
      if (pendingG) timer = setTimeout(() => (pendingG = false), 1500);
      const action = next.action;
      if (!action) return;
      e.preventDefault();
      if (action.type === 'view') useTeamStore.getState().setView(action.view);
      else if (action.type === 'palette') setPaletteOpen(true);
      else setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, []);

  // After an update, show what's new since the version last seen. Not on a first install, which only notes the version.
  useEffect(() => {
    const seen = usePrefsStore.getState().lastSeenVersion;
    const current = __APP_VERSION__;
    if (seen === current) return;
    // The starter team ("My Champions Team") is not a saved one: only a team with a Pokémon in it, or picker recents, mean the app was used before.
    const existing = Object.values(useTeamStore.getState().teams).some((t) => t.slots.some(Boolean)) || Object.values(usePrefsStore.getState().recent).some((l) => l?.length);
    if ((!seen && !existing) || (seen && compareVersions(seen, current) > 0)) {
      setLastSeen(current);
      return;
    }
    let alive = true;
    void import('virtual:changelog').then(({ default: releases }) => {
      if (!alive) return;
      // Someone who used the app before this feature existed has no version noted: show the latest release.
      const base = seen ?? releases[1]?.version ?? '0.0.0';
      if (releasesSince(releases, base, current).length) {
        setWhatsNewSince(base);
        setWhatsNewOpen(true);
      } else setLastSeen(current);
    });
    return () => {
      alive = false;
    };
  }, [setLastSeen]);
  const openWhatsNew = () => {
    setWhatsNewSince(undefined);
    setWhatsNewOpen(true);
  };

  // Cloud sync (opt-in): its code loads only once it is turned on.
  const syncOn = useSyncStore((s) => s.enabled);
  useEffect(() => {
    if (!syncOn || !syncAvailable()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('./sync/runner').then((m) => {
      if (!cancelled) stop = m.startAutoSync();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [syncOn]);

  // Deep link: #calc opens the calculator, #dex the Pokédex, #analyse/speed Analyse's Speed tab, … The hashes
  // of the screens that moved into Analyse (#speed, #threats, #ohko, #ohkod, #showcase, #compare) still work.
  const setRoute = useTeamStore((s) => s.setRoute);
  useEffect(() => {
    const fromHash = () => {
      const route = parseRoute(location.hash);
      if (route) setRoute(route);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [setRoute]);
  // Mirror the route into the hash — but not on mount, when the hash is the input (a deep link).
  const analyseTab = useTeamStore((s) => s.analyseTab);
  const ohkoMode = useTeamStore((s) => s.ohkoMode);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    try {
      history.replaceState(null, '', routeHash({ view, tab: analyseTab, ohko: ohkoMode }));
    } catch {
      /* sandboxed */
    }
  }, [view, analyseTab, ohkoMode]);
  // A new screen starts at the top, and keyboard/screen-reader focus moves to it (not on a tab change inside Analyse).
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [view]);

  const palette = usePrefsStore((s) => s.palette);
  const look = usePrefsStore((s) => s.look);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    root.dataset.look = look;
    // A chosen palette overrides the colour tokens inline; none means the hand-tuned defaults in index.css.
    const tokens = palette ? paletteTokens(palette, theme) : null;
    for (const name of PALETTE_TOKEN_NAMES) {
      if (tokens) root.style.setProperty(`--color-${name}`, tokens[name]);
      else root.style.removeProperty(`--color-${name}`);
    }
    // Browser UI (Android address bar, iOS Safari tab bar) matches the header.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens?.surface ?? (theme === 'dark' ? '#1c1f26' : '#fcfbf8'));
  }, [theme, palette, look]);

  const dex = dexState.status === 'ready' ? dexState.dex : undefined;
  const loading = (label: string) => <LoadingState label={label} />;

  let content: ReactNode;
  if (view === 'dex') content = <Suspense fallback={loading('Loading Pokédex…')}><PokedexView format={format} /></Suspense>;
  else if (view === 'atlas') content = <Suspense fallback={loading('Loading Pokénav…')}><AtlasView /></Suspense>;
  else if (view === 'gameday') content = <Suspense fallback={loading('Loading Game day…')}><GameDayView /></Suspense>;
  else if (view === 'analyse') content = <Suspense fallback={loading('Loading analysis…')}><AnalyseView /></Suspense>;
  else if (view === 'regdiff') content = <Suspense fallback={loading('Loading regulation diff…')}><RegulationDiffView /></Suspense>;
  else if (!dex) content = dexState.status === 'error' ? <p className="p-10 text-center text-sm text-bad" role="alert">{dexState.error}</p> : loading('Loading Pokédex data…');
  else if (view === 'calc') content = <Suspense fallback={loading('Loading damage calculator…')}><DamageCalcView dex={dex} format={format} team={team} /></Suspense>;
  else if (view === 'matches') content = <Suspense fallback={loading('Loading match log…')}><MatchesView dex={dex} format={format} /></Suspense>;
  else if (view === 'meta') content = <Suspense fallback={loading('Loading meta data…')}><MetaView dex={dex} format={format} /></Suspense>;
  else if (view === 'reverse') content = <Suspense fallback={loading('Loading reverse search…')}><ReverseSearchView dex={dex} format={format} team={team} /></Suspense>;
  else content = <Builder team={team} format={format} dex={dex} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className={buttonClass('primary', 'md', 'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]')}>
        Skip to content
      </a>
      <DesktopUpdater />
      <Header team={team} format={format} dex={dex} onOpenSettings={() => setSettingsOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
      <main id="main" tabIndex={-1} className={cn('mx-auto w-full flex-1 p-3 pb-24 outline-none sm:p-4 sm:pb-6', view === 'calc' ? 'max-w-[1800px]' : 'max-w-[1500px]')}>
        <h1 className="sr-only">{NAV_LABELS[view as NavId] ?? 'Build'} · Pokémon Team Builder</h1>
        {content}
      </main>
      <BottomTabs onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onOpenWhatsNew={() => (setSettingsOpen(false), openWhatsNew())} onOpenShortcuts={() => (setSettingsOpen(false), setShortcutsOpen(true))} />
        </Suspense>
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog open onOpenChange={setShortcutsOpen} />
        </Suspense>
      )}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette open onOpenChange={setPaletteOpen} onOpenSettings={() => setSettingsOpen(true)} onOpenWhatsNew={openWhatsNew} />
        </Suspense>
      )}
      {whatsNewOpen && (
        <Suspense fallback={null}>
          <WhatsNew
            open
            since={whatsNewSince}
            onOpenChange={(o) => {
              setWhatsNewOpen(o);
              if (!o) setLastSeen(__APP_VERSION__);
            }}
          />
        </Suspense>
      )}
      <Toaster />
    </div>
  );
}
