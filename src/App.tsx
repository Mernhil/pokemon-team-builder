import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Map as MapIcon,
  Calculator,
  Check,
  ChevronDown,
  Eraser,
  FolderOpen,
  Gauge,
  LayoutGrid,
  Columns2,
  Crosshair,
  GitCompare,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Skull,
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
import { PALETTE_TOKEN_NAMES, paletteTokens } from '@/domain/palette';
import { validateTeam } from '@/domain/validation';
import { usePrefsStore } from '@/store/prefsStore';
import { toast } from '@/store/toastStore';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { isSavedTeam } from '@/domain/team';
import { useActiveTeam, useTeamStore, type View } from '@/store/teamStore';
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
import { Menu, MenuItem, MenuSeparator } from './components/ui/Menu';
import { Toaster } from './components/ui/Toaster';
import { Button, LoadingState, Panel } from './components/ui/primitives';
import { buttonClass, cn, controlClass } from './components/ui/styles';

// Heavier screens load when first opened.
const DamageCalcView = lazy(() => import('./components/calc/DamageCalcView').then((m) => ({ default: m.DamageCalcView })));
const PokedexView = lazy(() => import('./components/pokedex/PokedexView').then((m) => ({ default: m.PokedexView })));
const AtlasView = lazy(() => import('./components/atlas/AtlasView').then((m) => ({ default: m.AtlasView })));
const MatchesView = lazy(() => import('./components/matches/MatchesView').then((m) => ({ default: m.MatchesView })));
const RegulationDiffView = lazy(() => import('./components/regulation/RegulationDiffView').then((m) => ({ default: m.RegulationDiffView })));
const ThreatReportView = lazy(() => import('./components/threats/ThreatReportView').then((m) => ({ default: m.ThreatReportView })));
const TeamShowcaseView = lazy(() => import('./components/showcase/TeamShowcaseView').then((m) => ({ default: m.TeamShowcaseView })));
const OhkoReportView = lazy(() => import('./components/threats/OhkoReportView').then((m) => ({ default: m.OhkoReportView })));
const ReverseSearchView = lazy(() => import('./components/reverse/ReverseSearchView').then((m) => ({ default: m.ReverseSearchView })));
const SpeedTiersView = lazy(() => import('./components/speed/SpeedTiersView').then((m) => ({ default: m.SpeedTiersView })));
const CompareView = lazy(() => import('./components/compare/CompareView').then((m) => ({ default: m.CompareView })));
const MetaView = lazy(() => import('./components/meta/MetaView').then((m) => ({ default: m.MetaView })));

interface Dest {
  id: View;
  label: string;
  icon: LucideIcon;
}
/** The three everyday destinations; the rest live under "More". */
const PRIMARY: Dest[] = [
  { id: 'builder', label: 'Build', icon: Users },
  { id: 'calc', label: 'Calc', icon: Calculator },
  { id: 'dex', label: 'Pokédex', icon: BookOpen },
  { id: 'atlas', label: 'Pokénav', icon: MapIcon },
];
const SECONDARY: Dest[] = [
  { id: 'matches', label: 'Match log', icon: Swords },
  { id: 'meta', label: 'Meta', icon: BarChart3 },
  { id: 'speed', label: 'Speed tiers', icon: Gauge },
  { id: 'threats', label: 'Threat report', icon: ShieldAlert },
  { id: 'ohkod', label: 'OHKO’d by', icon: Skull },
  { id: 'ohko', label: 'Can OHKO', icon: Crosshair },
  { id: 'reverse', label: 'Reverse search', icon: Search },
  { id: 'showcase', label: 'Team overview', icon: LayoutGrid },
  { id: 'compare', label: 'Compare teams', icon: Columns2 },
  { id: 'regdiff', label: 'Regulation diff', icon: GitCompare },
];
const VIEWS: View[] = ['builder', 'calc', 'dex', 'atlas', 'matches', 'meta', 'speed', 'threats', 'ohkod', 'ohko', 'showcase', 'reverse', 'regdiff', 'compare'];

export default function App() {
  const theme = useTeamStore((s) => s.theme);
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const dexState = useDex(format.datasetId);
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Deep link: #calc opens the calculator, #dex the Pokédex, #builder the team builder, …
  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.replace('#', '') as View;
      if (VIEWS.includes(h)) setView(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [setView]);
  // Mirror the view into the hash — but not on mount, when the hash is the input (a deep link).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    try {
      history.replaceState(null, '', `#${view}`);
    } catch {
      /* sandboxed */
    }
    // A new screen starts at the top, and keyboard/screen-reader focus moves to it.
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [view]);

  const palette = usePrefsStore((s) => s.palette);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    // A chosen palette overrides the colour tokens inline; none means the hand-tuned defaults in index.css.
    const tokens = palette ? paletteTokens(palette, theme) : null;
    for (const name of PALETTE_TOKEN_NAMES) {
      if (tokens) root.style.setProperty(`--color-${name}`, tokens[name]);
      else root.style.removeProperty(`--color-${name}`);
    }
    // Browser UI (Android address bar, iOS Safari tab bar) matches the header.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens?.surface ?? (theme === 'dark' ? '#1c1f26' : '#fcfbf8'));
  }, [theme, palette]);

  const dex = dexState.status === 'ready' ? dexState.dex : undefined;
  const loading = (label: string) => <LoadingState label={label} />;

  let content: ReactNode;
  if (view === 'dex') content = <Suspense fallback={loading('Loading Pokédex…')}><PokedexView format={format} /></Suspense>;
  else if (view === 'atlas') content = <Suspense fallback={loading('Loading Pokénav…')}><AtlasView /></Suspense>;
  else if (view === 'showcase') content = <Suspense fallback={loading('Loading team overview…')}><TeamShowcaseView /></Suspense>;
  else if (view === 'compare') content = <Suspense fallback={loading('Loading compare…')}><CompareView /></Suspense>;
  else if (view === 'regdiff') content = <Suspense fallback={loading('Loading regulation diff…')}><RegulationDiffView /></Suspense>;
  else if (!dex) content = dexState.status === 'error' ? <p className="p-10 text-center text-sm text-bad" role="alert">{dexState.error}</p> : loading('Loading Pokédex data…');
  else if (view === 'calc') content = <Suspense fallback={loading('Loading damage calculator…')}><DamageCalcView dex={dex} format={format} team={team} /></Suspense>;
  else if (view === 'matches') content = <Suspense fallback={loading('Loading match log…')}><MatchesView dex={dex} format={format} /></Suspense>;
  else if (view === 'meta') content = <Suspense fallback={loading('Loading meta data…')}><MetaView dex={dex} format={format} /></Suspense>;
  else if (view === 'speed') content = <Suspense fallback={loading('Loading speed tiers…')}><SpeedTiersView dex={dex} format={format} team={team} /></Suspense>;
  else if (view === 'reverse') content = <Suspense fallback={loading('Loading reverse search…')}><ReverseSearchView dex={dex} format={format} team={team} /></Suspense>;
  else if (view === 'ohko' || view === 'ohkod') content = <Suspense fallback={loading('Loading OHKO report…')}><OhkoReportView dex={dex} format={format} team={team} mode={view === 'ohko' ? 'to' : 'by'} /></Suspense>;
  else if (view === 'threats') content = <Suspense fallback={loading('Loading threat report…')}><ThreatReportView dex={dex} format={format} team={team} /></Suspense>;
  else content = <Builder team={team} format={format} dex={dex} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className={buttonClass('primary', 'md', 'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]')}>
        Skip to content
      </a>
      <DesktopUpdater />
      <Header team={team} format={format} dex={dex} onOpenSettings={() => setSettingsOpen(true)} />
      <main id="main" tabIndex={-1} className={cn('mx-auto w-full flex-1 p-3 pb-24 outline-none sm:p-4 sm:pb-6', view === 'calc' ? 'max-w-[1800px]' : 'max-w-[1500px]')}>
        <h1 className="sr-only">{[...PRIMARY, ...SECONDARY].find((d) => d.id === view)?.label ?? 'Build'} · Pokémon Team Builder</h1>
        {content}
      </main>
      <BottomTabs onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster />
    </div>
  );
}

/** Build · Calc · Pokédex, then More (Match log, Meta, Settings). Desktop and tablet. */
function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const secondary = SECONDARY.find((d) => d.id === view);
  const item = (active: boolean) =>
    cn('flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors', active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg');
  return (
    <nav aria-label="Main" className="hidden rounded-lg bg-surface-2 p-0.5 sm:flex">
      {PRIMARY.map((d) => (
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
        {SECONDARY.map((d) => (
          <MenuItem key={d.id} icon={d.icon} current={view === d.id} onSelect={() => setView(d.id)}>
            {d.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Settings} onSelect={onOpenSettings}>
          Settings &amp; credits
        </MenuItem>
      </Menu>
    </nav>
  );
}

/** Phone navigation: the same destinations as a bottom tab bar (clear of the home indicator). */
function BottomTabs({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const secondary = SECONDARY.find((d) => d.id === view);
  const tab = (active: boolean) =>
    cn('flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', active ? 'text-accent' : 'text-muted');
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {PRIMARY.map((d) => (
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
        {SECONDARY.map((d) => (
          <MenuItem key={d.id} icon={d.icon} current={view === d.id} onSelect={() => setView(d.id)}>
            {d.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Settings} onSelect={onOpenSettings}>
          Settings &amp; credits
        </MenuItem>
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

function Header({ team, format, dex, onOpenSettings }: { team: Team; format: FormatRules; dex?: Dex; onOpenSettings: () => void }) {
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
