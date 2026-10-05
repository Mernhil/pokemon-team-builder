import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Map as MapIcon,
  Calculator,
  Check,
  ChevronDown,
  Eraser,
  Flag,
  FolderOpen,
  GitCompare,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Settings,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useDex } from '@/data/useDex';
import type { Dex } from '@/data/dex';
import { FORMATS, currentRegulation, getFormat } from '@/domain/formats';
import { gameInfo } from '@/domain/games';
import { GEN_GAMES } from '@/domain/generations';
import type { FormatRules, Team } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { compareVersions, releasesSince } from '@/domain/changelog';
import { usePrefsStore } from '@/store/prefsStore';
import { toast } from '@/store/toastStore';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { isSavedTeam } from '@/domain/team';
import { NAV_LABELS, moreGroups, resolveBar, type NavId, type NavKind } from '@/domain/navigation';
import { parseRoute, routeHash } from '@/domain/routes';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { DefenseMatrix } from './components/analysis/DefenseMatrix';
import { OffenseMatrix } from './components/analysis/OffenseMatrix';
import { TeamCheck } from './components/analysis/TeamCheck';
import { DesktopUpdater, UpdateCheckButton } from './components/DesktopUpdater';
import { RegulationBanner } from './components/analysis/RegulationBanner';
import { SharedTeamBanner } from './components/team/SharedTeamBanner';
import { GenBadge } from './components/ui/GenBadge';
import { SetEditor } from './components/editor/SetEditor';
import { ImportExportDialog } from './components/io/ImportExportDialog';
import { SaveTeamDialog } from './components/io/SaveTeamDialog';
import { TeamsDialog } from './components/io/TeamsDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TeamSlots, TeamStrip } from './components/team/TeamSlots';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './components/ui/Menu';
import { Toaster } from './components/ui/Toaster';
import { Button, LoadingState, Panel } from './components/ui/primitives';
import { buttonClass, cn, controlClass } from './components/ui/styles';

// Heavier screens load when first opened.
const DamageCalcView = lazy(() => import('./components/calc/DamageCalcView').then((m) => ({ default: m.DamageCalcView })));
const PokedexView = lazy(() => import('./components/pokedex/PokedexView').then((m) => ({ default: m.PokedexView })));
const AtlasView = lazy(() => import('./components/atlas/AtlasView').then((m) => ({ default: m.AtlasView })));
const MatchesView = lazy(() => import('./components/matches/MatchesView').then((m) => ({ default: m.MatchesView })));
const RegulationDiffView = lazy(() => import('./components/regulation/RegulationDiffView').then((m) => ({ default: m.RegulationDiffView })));
// The palette and the "What's new" sheet load when first opened.
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const WhatsNew = lazy(() => import('./components/WhatsNew'));
const GameDayView = lazy(() => import('./components/gameday/GameDayView').then((m) => ({ default: m.GameDayView })));
const AnalyseView = lazy(() => import('./components/analyse/AnalyseView').then((m) => ({ default: m.AnalyseView })));
const ReverseSearchView = lazy(() => import('./components/reverse/ReverseSearchView').then((m) => ({ default: m.ReverseSearchView })));
const MetaView = lazy(() => import('./components/meta/MetaView').then((m) => ({ default: m.MetaView })));

/** Icons of every destination; the bar's contents come from the player's choice (domain/navigation.ts). */
const ICONS: Record<NavId, LucideIcon> = {
  builder: Users,
  calc: Calculator,
  analyse: Activity,
  dex: BookOpen,
  atlas: MapIcon,
  matches: Swords,
  gameday: Flag,
  meta: BarChart3,
  reverse: Search,
  regdiff: GitCompare,
};
const dest = (id: NavId) => ({ id, label: NAV_LABELS[id], icon: ICONS[id] });

/** The bar's destinations for this device kind and game, and the rest for More. */
function useNav(kind: NavKind) {
  const prefs = usePrefsStore((s) => s.nav);
  const champions = getFormat(useActiveTeam().formatId).datasetId === 'champions';
  return useMemo(() => {
    const bar = resolveBar(kind, prefs, champions);
    const more = moreGroups(bar, champions && !prefs[kind]);
    return { bar: bar.map(dest), main: more.main.map(dest), tools: more.tools.map(dest) };
  }, [kind, prefs, champions]);
}

export default function App() {
  const theme = useTeamStore((s) => s.theme);
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const dexState = useDex(format.datasetId);
  const view = useTeamStore((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  /** Set when the sheet opens by itself after an update: the version whose notes were last seen. */
  const [whatsNewSince, setWhatsNewSince] = useState<string>();
  const setLastSeen = usePrefsStore((s) => s.setLastSeenVersion);

  // Ctrl/Cmd+K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // After an update, show what's new since the version last seen. Not on a first install, which only notes the version.
  useEffect(() => {
    const seen = usePrefsStore.getState().lastSeenVersion;
    const current = __APP_VERSION__;
    if (seen === current) return;
    const existing = Object.values(useTeamStore.getState().teams).some(isSavedTeam) || Object.values(usePrefsStore.getState().recent).some((l) => l?.length);
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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    // Browser UI (Android address bar, iOS Safari tab bar) matches the header.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c1f26' : '#fcfbf8');
  }, [theme]);

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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onOpenWhatsNew={() => (setSettingsOpen(false), openWhatsNew())} />
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

/** The menu behind "More": whatever the bar leaves out (Match log, Meta, a Tools group…) and Settings. */
function MoreItems({ kind, onOpenSettings }: { kind: NavKind; onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const { main, tools } = useNav(kind);
  const item = (d: ReturnType<typeof dest>) => (
    <MenuItem key={d.id} icon={d.icon} current={view === d.id} onSelect={() => setView(d.id)}>
      {d.label}
    </MenuItem>
  );
  return (
    <>
      {main.map(item)}
      {main.length > 0 && tools.length > 0 && <MenuSeparator />}
      {tools.length > 0 && <MenuLabel>Tools</MenuLabel>}
      {tools.map(item)}
      <MenuSeparator />
      <MenuItem icon={Settings} onSelect={onOpenSettings}>
        Settings &amp; credits
      </MenuItem>
    </>
  );
}

/** The chosen destinations (Build · Calc · Analyse · Pokédex · Pokénav, or Reverse search for Champions, by default), then More. Desktop and tablet. */
function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const { bar, main, tools } = useNav('desktop');
  const secondary = [...main, ...tools].find((d) => d.id === view);
  const item = (active: boolean) =>
    cn('flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors', active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg');
  return (
    <nav aria-label="Main" className="hidden rounded-lg bg-surface-2 p-0.5 sm:flex">
      {bar.map((d) => (
        <button key={d.id} type="button" aria-current={view === d.id ? 'page' : undefined} onClick={() => setView(d.id)} className={item(view === d.id)}>
          <d.icon size={15} aria-hidden />
          {d.label}
        </button>
      ))}
      <Menu
        label="More destinations"
        align="start"
        trigger={
          <button type="button" className={item(!!secondary)} aria-current={secondary ? 'page' : undefined}>
            {secondary ? <secondary.icon size={15} aria-hidden /> : null}
            {secondary?.label ?? 'More'}
            <ChevronDown size={14} aria-hidden />
          </button>
        }
      >
        <MoreItems kind="desktop" onOpenSettings={onOpenSettings} />
      </Menu>
    </nav>
  );
}

/** Phone navigation: a bottom tab bar (clear of the home indicator) with the chosen destinations (four by default: Build · Calc · Analyse · Pokédex) and More. */
function BottomTabs({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const { bar, main, tools } = useNav('phone');
  const secondary = [...main, ...tools].find((d) => d.id === view);
  const tab = (active: boolean) =>
    cn('flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', active ? 'text-accent' : 'text-muted');
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {bar.map((d) => (
        <button key={d.id} type="button" aria-current={view === d.id ? 'page' : undefined} onClick={() => setView(d.id)} className={tab(view === d.id)}>
          <d.icon size={21} aria-hidden />
          {d.label}
        </button>
      ))}
      <Menu
        label="More destinations"
        trigger={
          <button type="button" className={tab(!!secondary)} aria-current={secondary ? 'page' : undefined}>
            {secondary ? <secondary.icon size={21} aria-hidden /> : <MoreHorizontal size={21} aria-hidden />}
            {secondary?.label ?? 'More'}
          </button>
        }
      >
        <MoreItems kind="phone" onOpenSettings={onOpenSettings} />
      </Menu>
    </nav>
  );
}

function FormatBadge({ format }: { format: FormatRules }) {
  const game = gameInfo(format.game);
  if (game)
    return (
      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-muted uppercase" title={game.name}>
        {game.shortName}
      </span>
    );
  if (format.datasetId === 'champions')
    return <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-accent uppercase">Champions</span>;
  return <GenBadge gen={format.generation} />;
}

function Header({ team, format, dex, onOpenSettings, onOpenPalette }: { team: Team; format: FormatRules; dex?: Dex; onOpenSettings: () => void; onOpenPalette: () => void }) {
  const { switchFormat, saveTeam, clearTeam, restoreSlots, newTeam, selectTeam, deleteTeam } = useTeamStore.getState();
  const isEmpty = team.slots.every((s) => s === null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const liveRegId = currentRegulation()?.id;

  const clearWithUndo = () => {
    // Edits save into the open team as you go, so wiping a saved or named team would wipe the saved one:
    // start a fresh team instead and leave it where it is. Only the scratch draft is emptied in place.
    if (isSavedTeam(team)) {
      const kept = team;
      const fresh = newTeam(team.formatId);
      toast(`Started a new team. “${kept.name}” is still in Saved teams.`, {
        label: 'Undo',
        run: () => {
          selectTeam(kept.id);
          deleteTeam(fresh);
        },
      });
      return;
    }
    const before = team.slots;
    const link = { editingFrom: useTeamStore.getState().editingFrom, editingDraft: useTeamStore.getState().editingDraft };
    clearTeam(team.id);
    // A cleared build is a fresh start: Save no longer offers to update the team it came from.
    useTeamStore.setState({ editingFrom: null, editingDraft: null });
    toast('Cleared the team.', {
      label: 'Undo',
      run: () => {
        restoreSlots(team.id, before);
        useTeamStore.setState(link);
      },
    });
  };

  const formatSelect = (
    <select
      aria-label="Game and format"
      className={controlClass(false, 'w-full min-w-0 px-2 sm:w-auto sm:max-w-[20rem] sm:shrink')}
      value={format.id}
      onChange={(e) => switchFormat(team.id, e.target.value)}
    >
      {[
        { label: 'Pokémon Champions', formats: FORMATS.filter((f) => f.datasetId === 'champions') },
        { label: 'Main series · Gen 1–9', formats: FORMATS.filter((f) => f.datasetId !== 'champions' && !f.game) },
        { label: "Main series · Let's Go, BDSP, Legends", formats: FORMATS.filter((f) => f.game) },
      ].map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.formats.map((f) => (
            <option key={f.id} value={f.id} disabled={!f.available}>
              {f.name}
              {f.regulationId && f.regulationId === liveRegId ? ' (live)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="status-band" aria-hidden />
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <span className="hidden items-center gap-2 md:flex">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-accent)" strokeWidth="3" />
            <path d="M2 16h9M21 16h9" stroke="var(--color-accent)" strokeWidth="3" />
            <circle cx="16" cy="16" r="4.5" fill="var(--color-accent)" />
          </svg>
          <span className="hidden text-sm font-bold tracking-tight lg:inline">Team Builder</span>
        </span>
        <TopNav onOpenSettings={onOpenSettings} />

        {/* The team being edited and its format: inline from xl up, a second row below that. */}
        <div className="order-last flex w-full min-w-0 items-center gap-2 xl:order-none xl:w-auto xl:flex-1">
          <span className="hidden sm:inline-flex">
            <FormatBadge format={format} />
          </span>
          {formatSelect}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className={buttonClass('default', 'icon')} onClick={onOpenPalette} aria-label="Search (Ctrl K)" title="Search · Ctrl/⌘ K">
            <Search size={17} aria-hidden />
          </button>
          <UpdateCheckButton />
          <Button variant="primary" onClick={() => setSaveOpen(true)}>
            {justSaved ? <Check size={15} aria-hidden /> : <Save size={15} aria-hidden />}
            {justSaved ? 'Saved' : 'Save'}
          </Button>
          <Menu
            label="Team actions"
            trigger={
              <button type="button" className={buttonClass('default', 'icon')}>
                <MoreHorizontal size={18} aria-hidden />
              </button>
            }
          >
            <MenuItem icon={FolderOpen} onSelect={() => setTeamsOpen(true)}>
              Saved teams
            </MenuItem>
            <MenuItem icon={ArrowLeftRight} disabled={!dex} onSelect={() => setIoOpen(true)}>
              Import / Export
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Eraser} disabled={isEmpty} tone="danger" onSelect={clearWithUndo}>
              Clear this team
            </MenuItem>
          </Menu>
        </div>
      </div>
      <TeamsDialog open={teamsOpen} onOpenChange={setTeamsOpen} dex={dex} />
      <SaveTeamDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        currentName={team.name}
        onSave={(name, mode, targetId) => {
          saveTeam(name, mode, targetId);
          setJustSaved(true);
          toast(mode === 'overwrite' ? `Overwrote “${name}”.` : mode === 'variation' ? `Added a variation to “${name}”.` : `Saved “${name}” to your teams.`);
          window.setTimeout(() => setJustSaved(false), 1500);
        }}
      />
      {dex && <ImportExportDialog open={ioOpen} onOpenChange={setIoOpen} team={team} dex={dex} format={format} />}
    </header>
  );
}

/**
 * Workbench layout: team on the left, the selected Pokémon in the middle, team check on the right
 * (below the editor on narrower screens). Phones get a sprite strip instead of the team list.
 */
function Builder({ team, format, dex }: { team: Team; format: FormatRules; dex: Dex }) {
  const activeSlot = useTeamStore((s) => s.activeSlot);
  const setActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const issues = useMemo(() => validateTeam(team, format, dex), [team, format, dex]);
  const filled = team.slots.filter(Boolean).length;
  const firstEmpty = team.slots.findIndex((s) => s === null);

  return (
    <div className="grid content-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      {team.shared && (
        <div className="lg:col-span-2 xl:col-span-3">
          <SharedTeamBanner team={team} />
        </div>
      )}
      <div className="lg:col-span-2 xl:col-span-3">
        <RegulationBanner team={team} format={format} />
      </div>

      {/* Phones: one tap to the next empty slot (its species search opens there). */}
      {firstEmpty >= 0 && team.slots[activeSlot] && (
        <button
          type="button"
          onClick={() => {
            setActiveSlot(firstEmpty);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-xl sm:hidden"
          aria-label={`Add a Pokémon (slot ${firstEmpty + 1})`}
        >
          <Plus size={26} aria-hidden />
        </button>
      )}

      <aside aria-label="Team" className="hidden lg:sticky lg:top-[72px] lg:block lg:self-start">
        <Panel
          title={
            <>
              Team <span className="font-normal text-muted">· {filled}/{format.teamSize}</span>
            </>
          }
          actions={format.bring ? <span className="text-xs text-muted">Bring {format.bring}, pick {format.pick} · {format.gameType}</span> : undefined}
          bodyClassName="p-2 pt-1"
        >
          <TeamSlots team={team} dex={dex} format={format} issues={issues} activeSlot={activeSlot} />
        </Panel>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="lg:hidden">
          <TeamStrip team={team} dex={dex} format={format} issues={issues} activeSlot={activeSlot} />
        </div>
        <SetEditor key={team.id + activeSlot} teamId={team.id} slot={activeSlot} set={team.slots[activeSlot]} dex={dex} format={format} issues={issues} />
      </div>

      <aside aria-label="Team check" className="min-w-0 space-y-4 lg:col-start-2 xl:sticky xl:top-[72px] xl:col-start-3 xl:row-start-2 xl:self-start">
        <TeamCheck team={team} dex={dex} format={format} issues={issues} />
      </aside>

      <div className="min-w-0 space-y-4 lg:col-start-2 xl:col-span-1 xl:col-start-2">
        <DefenseMatrix team={team} dex={dex} format={format} />
        <OffenseMatrix team={team} dex={dex} />
        <p className="pb-2 text-center text-xs text-muted">
          {format.game
            ? `Data: ${dex.data.source} · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
            : dex.data.generation
              ? `Data: Pokémon Showdown's Gen ${dex.data.generation} data (${GEN_GAMES[dex.data.generation]}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
              : `Data: Pokémon Showdown + official regulation announcements (${dex.data.regulations.map((r) => r.shortName).join(', ')}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`}
        </p>
      </div>
    </div>
  );
}
