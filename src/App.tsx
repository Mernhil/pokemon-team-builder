import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, BookOpen, Calculator, ChevronDown, FolderOpen, Moon, Sun, Users } from 'lucide-react';
import { useDex } from '@/data/useDex';
import type { Dex } from '@/data/dex';
import { FORMATS, currentRegulation, getFormat } from '@/domain/formats';
import { gameInfo } from '@/domain/games';
import { GEN_GAMES } from '@/domain/generations';
import type { FormatRules, Team } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { DefenseMatrix } from './components/analysis/DefenseMatrix';
import { DesktopUpdater } from './components/DesktopUpdater';
import { RegulationBanner } from './components/analysis/RegulationBanner';
import { GenBadge } from './components/ui/GenBadge';
import { ValidationPanel } from './components/analysis/ValidationPanel';
import { SetEditor } from './components/editor/SetEditor';
import { ImportExportDialog } from './components/io/ImportExportDialog';
import { TeamsDialog } from './components/io/TeamsDialog';
import { TeamSlots } from './components/team/TeamSlots';
import { Button, Select, cn } from './components/ui/primitives';

// The damage calculator engine is sizeable; load it only when the tab is opened.
const DamageCalcView = lazy(() => import('./components/calc/DamageCalcView').then((m) => ({ default: m.DamageCalcView })));
const PokedexView = lazy(() => import('./components/pokedex/PokedexView').then((m) => ({ default: m.PokedexView })));

export default function App() {
  const theme = useTeamStore((s) => s.theme);
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const dexState = useDex(format.datasetId);

  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);

  // Deep link: #calc opens the calculator, #dex the Pokédex, #builder the team builder.
  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.replace('#', '');
      if (h === 'calc' || h === 'builder' || h === 'dex') setView(h);
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
  }, [view]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="flex min-h-full flex-col">
      <DesktopUpdater />
      <Header team={team} format={format} dex={dexState.status === 'ready' ? dexState.dex : undefined} />
      {view === 'dex' ? (
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4">
          <Suspense fallback={<p className="p-10 text-center text-sm text-muted">Loading Pokédex…</p>}>
            <PokedexView format={format} />
          </Suspense>
        </main>
      ) : dexState.status === 'ready' ? (
        view === 'calc' ? (
          <main className="mx-auto w-full max-w-[1400px] flex-1 p-4">
            <Suspense fallback={<p className="p-10 text-center text-sm text-muted">Loading damage calculator…</p>}>
              <DamageCalcView dex={dexState.dex} format={format} team={team} />
            </Suspense>
          </main>
        ) : (
          <Builder team={team} format={format} dex={dexState.dex} />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted">
          {dexState.status === 'loading' ? 'Loading Pokédex…' : dexState.error}
        </div>
      )}
    </div>
  );
}

function ViewTabs() {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const tabs = [
    { id: 'builder' as const, label: 'Builder', icon: Users },
    { id: 'calc' as const, label: 'Damage Calc', icon: Calculator },
    { id: 'dex' as const, label: 'Pokédex', icon: BookOpen },
  ];
  return (
    <nav className="flex rounded-lg bg-surface-2 p-0.5" aria-label="Sections">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-current={view === t.id ? 'page' : undefined}
          aria-label={t.label}
          onClick={() => setView(t.id)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors',
            view === t.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          <t.icon size={14} />
          <span className="hidden sm:inline">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Header({ team, format, dex }: { team: Team; format: FormatRules; dex?: Dex }) {
  const theme = useTeamStore((s) => s.theme);
  const { updateTeam, setTheme } = useTeamStore.getState();
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const liveRegId = currentRegulation()?.id;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="mr-2 flex items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-accent)" strokeWidth="3" />
            <path d="M2 16h9M21 16h9" stroke="var(--color-accent)" strokeWidth="3" />
            <circle cx="16" cy="16" r="4.5" fill="var(--color-accent)" />
          </svg>
          <span className="hidden text-sm font-bold tracking-tight xl:inline">Team Builder</span>
        </div>
        <ViewTabs />
        <input
          value={team.name}
          onChange={(e) => updateTeam(team.id, { name: e.target.value })}
          aria-label="Team name"
          className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold outline-none hover:border-border focus:border-accent sm:max-w-xs"
        />
        <span className="hidden sm:inline-flex">
          {format.game ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white" style={{ background: gameInfo(format.game)!.color }} title={gameInfo(format.game)!.name}>
              {gameInfo(format.game)!.shortName.toUpperCase()}
            </span>
          ) : format.datasetId === 'champions' ? (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent-fg" title="Pokémon Champions">
              CHAMPIONS
            </span>
          ) : (
            <GenBadge gen={format.generation} />
          )}
        </span>
        <Select
          aria-label="Format"
          className="order-last w-full sm:order-none sm:w-auto sm:max-w-[19rem]"
          value={format.id}
          onChange={(e) => updateTeam(team.id, { formatId: e.target.value, category: getFormat(e.target.value).shortName })}
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
        </Select>
        <div className="ml-auto flex items-center gap-1.5">
          <Button onClick={() => setTeamsOpen(true)}>
            <FolderOpen size={14} /> <span className="hidden sm:inline">Teams</span>
          </Button>
          <Button onClick={() => setIoOpen(true)} disabled={!dex}>
            <ArrowLeftRight size={14} /> <span className="hidden sm:inline">Import / Export</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </div>
      <TeamsDialog open={teamsOpen} onOpenChange={setTeamsOpen} dex={dex} />
      {dex && <ImportExportDialog open={ioOpen} onOpenChange={setIoOpen} team={team} dex={dex} format={format} />}
    </header>
  );
}

function Builder({ team, format, dex }: { team: Team; format: FormatRules; dex: Dex }) {
  const activeSlot = useTeamStore((s) => s.activeSlot);
  const issues = useMemo(() => validateTeam(team, format, dex), [team, format, dex]);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const filled = team.slots.filter(Boolean).length;

  return (
    <main className="mx-auto grid w-full max-w-[1400px] flex-1 content-start grid-cols-1 gap-4 p-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="lg:col-span-2">
        <RegulationBanner team={team} format={format} />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-[68px] lg:self-start">
        <div className="rounded-xl border border-border bg-surface p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between px-1 pb-2 text-left"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-expanded={drawerOpen}
          >
            <span className="text-sm font-semibold">
              Team <span className="font-normal text-muted">· {filled}/{format.teamSize}</span>
              {format.bring && (
                <span className="ml-2 text-[11px] font-normal text-muted">
                  Bring {format.bring}, pick {format.pick} · {format.gameType}
                </span>
              )}
            </span>
            <ChevronDown size={16} className={cn('text-muted transition-transform lg:hidden', drawerOpen && 'rotate-180')} />
          </button>
          <div className={cn(!drawerOpen && 'hidden lg:block')}>
            <TeamSlots
              team={team}
              dex={dex}
              format={format}
              issues={issues}
              activeSlot={activeSlot}
              onSelect={() => window.innerWidth < 1024 && setDrawerOpen(false)}
            />
          </div>
        </div>
        <div className="hidden lg:block">
          <ValidationPanel issues={issues} />
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <SetEditor key={team.id + activeSlot} slot={activeSlot} set={team.slots[activeSlot]} dex={dex} format={format} issues={issues} />
        <div className="lg:hidden">
          <ValidationPanel issues={issues} />
        </div>
        <DefenseMatrix team={team} dex={dex} format={format} />
        <p className="pb-2 text-center text-[11px] text-muted">
          {format.game
            ? `Data: ${dex.data.source} · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
            : dex.data.generation
            ? `Data: Pokémon Showdown's Gen ${dex.data.generation} data (${GEN_GAMES[dex.data.generation]}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
            : `Data: Pokémon Showdown + official regulation announcements (${dex.data.regulations.map((r) => r.shortName).join(', ')}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`}
        </p>
      </div>
    </main>
  );
}
