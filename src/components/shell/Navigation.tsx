import { useMemo } from 'react';
import { Activity, BarChart3, BookOpen, Map as MapIcon, Calculator, ChevronDown, Flag, GitCompare, MoreHorizontal, Search, Settings, Swords, Users, type LucideIcon } from 'lucide-react';
import { getFormat } from '@/domain/formats';
import { usePrefsStore } from '@/store/prefsStore';
import { NAV_LABELS, moreGroups, resolveBar, type NavId, type NavKind } from '@/domain/navigation';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { cn } from '../ui/styles';

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
export function TopNav({ onOpenSettings }: { onOpenSettings: () => void }) {
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
export function BottomTabs({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useTeamStore((s) => s.view);
  const setView = useTeamStore((s) => s.setView);
  const { bar, main, tools } = useNav('phone');
  const secondary = [...main, ...tools].find((d) => d.id === view);
  const tab = (active: boolean) =>
    cn('flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-semibold', active ? 'text-accent' : 'text-muted');
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
