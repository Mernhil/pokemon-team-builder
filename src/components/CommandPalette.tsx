import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calculator,
  Flag,
  GitCompare,
  Map as MapIcon,
  Moon,
  Search,
  Settings,
  Sparkles,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useDex } from '@/data/useDex';
import { defaultSide } from '@/domain/battle/conditions';
import { ATLAS_GAMES } from '@/domain/atlas';
import { getFormat } from '@/domain/formats';
import { bookForFormat } from '@/domain/games';
import { fuzzyRank } from '@/domain/fuzzy';
import { defaultSet } from '@/domain/reverseSearch';
import type { AnalyseTab, OhkoMode, View } from '@/domain/routes';
import { teamChoices } from '@/domain/teamCompare';
import { useAtlasStore } from '@/store/atlasStore';
import { useCalcStore } from '@/store/calcStore';
import { usePokedexStore } from '@/store/pokedexStore';
import { useShowcaseStore } from '@/store/showcaseStore';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { cn } from './ui/styles';

interface Command {
  id: string;
  group: string;
  label: string;
  /** Right-hand context ("Analyse", "Team"). */
  hint?: string;
  /** Extra words that find it ("overview" finds Analyse · Overview). */
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

const PER_GROUP = 6;
const MAX_SPECIES = 5;

/**
 * The command palette (Ctrl/Cmd+K, or the search button in the header): one box that finds every screen and
 * Analyse tab, your saved teams, Pokémon (their Pokédex page, or the Calc with them as the attacker),
 * Pokénav games and settings. A combobox: type, arrow keys, Enter; Esc closes.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenWhatsNew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
}) {
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const dexState = useDex(format.datasetId);
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const go = (view: View) => () => useTeamStore.getState().setView(view);
  const analyse = (tab: AnalyseTab, ohko?: OhkoMode) => () => useTeamStore.getState().openAnalyse(tab, ohko);

  const base = useMemo<Command[]>(() => {
    const dest = (id: string, label: string, icon: LucideIcon, run: () => void, extra: Partial<Command> = {}): Command => ({ id, group: 'Go to', label, icon, run, ...extra });
    const store = useTeamStore.getState;
    const choices = teamChoices(teams, order);
    const teamRows = choices.flatMap((c): Command[] => [
      {
        id: `team-edit:${c.id}`,
        group: 'Teams',
        label: c.label,
        hint: 'Open in the builder',
        icon: Users,
        run: () => {
          if (teams[c.id]?.shared) store().selectTeam(c.id);
          else store().editTeam(c.id);
          store().setView('builder');
        },
      },
      {
        id: `team-analyse:${c.id}`,
        group: 'Teams',
        label: c.label,
        hint: 'Analyse',
        keywords: 'analyse overview',
        icon: Activity,
        run: () => {
          useShowcaseStore.getState().show(c.id);
          store().openAnalyse('overview');
        },
      },
    ]);
    return [
      dest('go-builder', 'Build', Users, go('builder'), { keywords: 'team builder' }),
      dest('go-calc', 'Calc', Calculator, go('calc'), { keywords: 'damage calculator' }),
      dest('go-analyse', 'Analyse', Activity, analyse('overview')),
      dest('go-overview', 'Analyse · Overview', Activity, analyse('overview'), { keywords: 'team overview showcase' }),
      dest('go-speed', 'Analyse · Speed', Activity, analyse('speed'), { keywords: 'speed tiers outspeed' }),
      dest('go-threats', 'Analyse · Threats', Activity, analyse('threats'), { keywords: 'threat report' }),
      dest('go-ohkod', 'Analyse · OHKO · Can be OHKO’d by', Activity, analyse('ohko', 'by'), { keywords: 'ohko' }),
      dest('go-ohko', 'Analyse · OHKO · Can OHKO', Activity, analyse('ohko', 'to'), { keywords: 'ohko' }),
      dest('go-compare', 'Analyse · Compare', Activity, analyse('compare'), { keywords: 'compare teams' }),
      dest('go-dex', 'Pokédex', BookOpen, go('dex')),
      dest('go-atlas', 'Pokénav', MapIcon, go('atlas'), { keywords: 'maps atlas locations trainers' }),
      dest('go-matches', 'Match log', Swords, go('matches'), { keywords: 'matches' }),
      dest('go-gameday', 'Game day', Flag, go('gameday'), { keywords: 'start a match play ranked team preview plan bring lead' }),
      dest('go-meta', 'Meta', BarChart3, go('meta'), { keywords: 'usage' }),
      dest('go-reverse', 'Reverse search', Search, go('reverse'), { keywords: 'tools' }),
      dest('go-regdiff', 'Regulation diff', GitCompare, go('regdiff'), { keywords: 'tools regulation changes' }),
      ...teamRows,
      ...ATLAS_GAMES.map(
        (g): Command => ({
          id: `atlas:${g.id}`,
          group: 'Pokénav',
          label: g.name,
          hint: 'Pokénav',
          keywords: 'map atlas',
          icon: MapIcon,
          run: () => {
            useAtlasStore.getState().setGame(g.id);
            store().setView('atlas');
          },
        }),
      ),
      { id: 'settings', group: 'Settings', label: 'Settings & credits', icon: Settings, run: onOpenSettings, keywords: 'sync appearance' },
      { id: 'whatsnew', group: 'Settings', label: 'What’s new', icon: Sparkles, run: onOpenWhatsNew, keywords: 'changelog updates' },
      { id: 'theme-light', group: 'Settings', label: 'Light theme', icon: Settings, run: () => store().setTheme('light'), keywords: 'appearance' },
      { id: 'theme-dark', group: 'Settings', label: 'Dark theme', icon: Moon, run: () => store().setTheme('dark'), keywords: 'appearance' },
    ];
  }, [teams, order, onOpenSettings, onOpenWhatsNew]);

  const dex = dexState.status === 'ready' ? dexState.dex : undefined;
  const speciesList = useMemo(() => dex?.selectableSpecies(format.regulationId) ?? [], [dex, format.regulationId]);

  const results = useMemo<Command[]>(() => {
    const text = (c: Command) => `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`;
    const q = query.trim();
    const groups = new Map<string, Command[]>();
    for (const c of base) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    const out: Command[] = [];
    for (const [group, list] of groups) {
      // Without a query: every destination, then the first few teams and settings.
      const ranked = q ? fuzzyRank(q, list, text, PER_GROUP) : group === 'Go to' ? list : group === 'Pokénav' ? [] : list.slice(0, 5);
      out.push(...ranked);
    }
    if (dex && q.length >= 2) {
      const book = bookForFormat(format);
      for (const s of fuzzyRank(q, speciesList, (x) => x.name, MAX_SPECIES)) {
        out.push(
          {
            id: `dex:${s.id}`,
            group: 'Pokémon',
            label: s.name,
            hint: 'Pokédex',
            icon: BookOpen,
            run: () => {
              usePokedexStore.getState().select(book.id, s.id);
              usePokedexStore.getState().setTab('info');
              useTeamStore.getState().setView('dex');
            },
          },
          {
            id: `calc:${s.id}`,
            group: 'Pokémon',
            label: `Calc: ${s.name} vs …`,
            hint: 'Damage Calc',
            icon: Calculator,
            run: () => {
              useCalcStore.getState().setSide('attacker', { set: defaultSet(dex, s.id, format), cond: defaultSide(false), crits: [false, false, false, false] });
              useTeamStore.getState().setView('calc');
            },
          },
        );
      }
    }
    return out;
  }, [base, query, dex, speciesList, format]);

  // Keep the highlighted row in range and in view.
  const current = Math.min(active, Math.max(results.length - 1, 0));
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // After the dialog has closed, so a dialog this opens (Settings) is not closed by the focus return.
    window.setTimeout(c.run, 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') setActive((current + 1) % results.length);
    else if (e.key === 'ArrowUp') setActive((current - 1 + results.length) % results.length);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(results.length - 1);
    else if (e.key === 'Enter') choose(results[current]);
    else return;
    e.preventDefault();
  };

  // Rows in order, with a heading wherever the group changes.
  const rows: { cmd: Command; index: number; heading?: string }[] = results.map((cmd, index) => ({ cmd, index, heading: index === 0 || results[index - 1].group !== cmd.group ? cmd.group : undefined }));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto flex max-h-[min(34rem,80dvh)] max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-fg shadow-2xl sm:top-[12dvh]"
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={16} className="shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results.length ? `${listId}-${current}` : undefined}
              aria-autocomplete="list"
              aria-label="Search screens, teams, Pokémon and settings"
              placeholder="Search screens, teams, Pokémon…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="scrollbar-thin overflow-auto overscroll-contain p-1.5">
            {rows.map(({ cmd, index, heading }) => (
              <div key={cmd.id}>
                {heading && (
                  <div aria-hidden className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">
                    {heading}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  data-index={index}
                  aria-selected={index === current}
                  onMouseMove={() => index !== current && setActive(index)}
                  onClick={() => choose(cmd)}
                  className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm select-none', index === current && 'bg-surface-2')}
                >
                  <cmd.icon size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                  {cmd.hint && <span className="shrink-0 text-xs text-muted">{cmd.hint}</span>}
                </div>
              </div>
            ))}
            {!results.length && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>}
          </div>
          <p role="status" className="sr-only">
            {results.length === 0 ? 'No results' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
