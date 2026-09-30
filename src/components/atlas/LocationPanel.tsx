import { useMemo, useState } from 'react';
import { BookOpen, Check, CircleDot, Coins, Gift, Landmark, MapPin, Package, ShoppingBag, Swords, Users, X } from 'lucide-react';
import { wildAt, itemKey, type AtlasItemSpot, type AtlasLocation, type AtlasNpc, type AtlasShop, type WildRow } from '@/domain/atlas';
import { usePokedexStore } from '@/store/pokedexStore';
import { useAtlasStore, useProgress, type LocationTab } from '@/store/atlasStore';
import { useTeamStore } from '@/store/teamStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useAtlasCtx } from './context';
import { KIND_LABEL } from './TrainerDetail';

const HOW_LABEL: Record<AtlasItemSpot['how'], string> = { visible: 'On the ground', hidden: 'Hidden', gift: 'Gift', tm: 'TM', hm: 'HM', mart: 'Mart', berry: 'Berry' };
const KIND_NAME: Record<AtlasLocation['kind'], string> = {
  city: 'City', town: 'Town', route: 'Route', 'sea-route': 'Sea route', cave: 'Cave', dungeon: 'Dungeon', landmark: 'Landmark', building: 'Building',
};

const TABS: { id: LocationTab; label: string; icon: typeof MapPin }[] = [
  { id: 'overview', label: 'Overview', icon: Landmark },
  { id: 'items', label: 'Items', icon: Package },
  { id: 'npcs', label: 'NPCs', icon: Users },
  { id: 'wild', label: 'Wild', icon: CircleDot },
  { id: 'trainers', label: 'Trainers', icon: Swords },
  { id: 'events', label: 'Notes', icon: BookOpen },
];

/** Everything about one location, in tabs. Used as the desktop side panel and the phone bottom sheet. */
export function LocationPanel({ loc, onClose }: { loc: AtlasLocation; onClose?: () => void }) {
  const { game, pokedex } = useAtlasCtx();
  const [tab, setTab] = useState<LocationTab>('overview');
  const wild = useMemo(() => (pokedex ? wildAt(pokedex, game.dexGame, loc.id) : []), [pokedex, game.dexGame, loc.id]);
  const progress = useProgress(game.id);
  const toggle = useAtlasStore((s) => s.toggle);
  const done = progress.locations.includes(loc.id);
  const counts: Partial<Record<LocationTab, number>> = { items: loc.items.length, npcs: loc.npcs.length, wild: wild.length, trainers: loc.trainers.length };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-tight font-semibold">{loc.name}</h2>
          <p className="text-xs text-muted">{KIND_NAME[loc.kind]}</p>
        </div>
        <Button size="sm" variant={done ? 'primary' : 'default'} aria-pressed={done} onClick={() => toggle(game.id, 'locations', loc.id)}>
          <Check size={14} aria-hidden /> {done ? 'Visited' : 'Mark visited'}
        </Button>
        {onClose && (
          <Button size="icon-sm" variant="ghost" aria-label="Close location" onClick={onClose}>
            <X size={16} aria-hidden />
          </Button>
        )}
      </header>
      <Tabs
        label="Location details"
        size="sm"
        value={tab}
        onChange={setTab}
        className="-mx-1 overflow-x-auto"
        tabs={TABS.map((t) => ({ id: t.id, icon: t.icon, label: <>{t.label}{counts[t.id] ? <span className="ml-0.5 font-mono font-normal text-muted">{counts[t.id]}</span> : null}</> }))}
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'overview' && <Overview loc={loc} />}
        {tab === 'items' && <Items loc={loc} />}
        {tab === 'npcs' && <Npcs loc={loc} />}
        {tab === 'wild' && <Wild rows={wild} loading={!pokedex} />}
        {tab === 'trainers' && <TrainerList ids={loc.trainers} />}
        {tab === 'events' && <Notes loc={loc} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Overview({ loc }: { loc: AtlasLocation }) {
  const { locName, openLocation, file } = useAtlasCtx();
  const badge = loc.gym;
  const leaderId = loc.trainers.find((id) => file.trainers[id]?.kind === 'leader' && file.trainers[id].order === 0);
  const { openTrainer } = useAtlasCtx();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {loc.pokecenter && <Chip tone="good">Pokémon Center</Chip>}
        {loc.shops.length > 0 && <Chip icon={ShoppingBag}>Poké Mart</Chip>}
        {badge && <Chip tone="accent" icon={Swords}>Gym</Chip>}
        {loc.obstacles.map((o) => <Chip key={o} tone="warn">{o}</Chip>)}
      </div>
      <p className="text-sm text-muted">
        {loc.maps.length ? `${loc.maps.length} in-game map${loc.maps.length > 1 ? 's' : ''} (${loc.maps.slice(0, 4).map((m) => m.replace(/_/g, ' ')).join(', ')}${loc.maps.length > 4 ? '…' : ''}).` : 'This place is on the Town Map but has no map of its own in the game data.'}
      </p>
      {badge && (
        <Section title="Gym">
          <div className="rounded-lg border border-border p-2 text-sm">
            <p>
              Leader{' '}
              {leaderId ? (
                <button type="button" className="font-semibold text-accent hover:underline" onClick={() => openTrainer(file.trainers[leaderId].group)}>
                  {badge.leader}
                </button>
              ) : (
                <b>{badge.leader}</b>
              )}
              {badge.type ? ` · ${badge.type} type` : ''}
            </p>
            <p className="text-muted">
              {badge.badge} Badge · level cap Lv {badge.levelCap}
            </p>
          </div>
        </Section>
      )}
      {loc.shops.length > 0 && (
        <Section title="Shops">
          <div className="space-y-2">{loc.shops.map((s, i) => <Shop key={i} shop={s} />)}</div>
        </Section>
      )}
      {loc.connections.length > 0 && (
        <Section title="Connections">
          <p className="flex flex-wrap gap-1">
            {loc.connections.map((c) => (
              <button key={c} type="button" onClick={() => openLocation(c)} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-accent hover:underline">
                {locName(c)}
              </button>
            ))}
          </p>
        </Section>
      )}
      <Section title="Requirements to reach">
        <p className="text-sm text-muted">
          {loc.obstacles.length ? `Obstacles here: ${loc.obstacles.join(', ')} (from the map's objects).` : 'No HM obstacles are placed on this area’s maps.'} The story flags that open a path aren’t listed in the game data in a readable form.
        </p>
      </Section>
    </div>
  );
}

function Shop({ shop }: { shop: AtlasShop }) {
  const { file, openItem } = useAtlasCtx();
  return (
    <div className="rounded-lg border border-border">
      <h4 className="flex items-center justify-between gap-2 px-2 pt-1.5 text-sm font-semibold">
        {shop.name}
        {shop.badgeStock && <span className="text-[11px] font-normal text-muted">stock grows with badges</span>}
      </h4>
      <ul className="p-1">
        {shop.items.map((it) => (
          <li key={it.item} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface-2">
            <ItemSprite itemId={it.item} size={20} />
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent hover:underline" onClick={() => openItem(it.item)}>
              {file.items[it.item]?.name ?? it.item}
            </button>
            {it.badges ? <span className="text-[11px] text-muted">{it.badges}+ badge{it.badges > 1 ? 's' : ''}</span> : null}
            <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums"><Coins size={11} aria-hidden /> {it.price.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Items({ loc }: { loc: AtlasLocation }) {
  const { file, game, openItem } = useAtlasCtx();
  const progress = useProgress(game.id);
  const toggle = useAtlasStore((s) => s.toggle);
  if (!loc.items.length && !loc.shops.length) return <EmptyState icon={Package} title="No items here">Nothing to pick up in this location’s maps.</EmptyState>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {loc.items.map((it, i) => {
          const key = itemKey(loc.id, i);
          const got = progress.items.includes(key);
          return (
            <li key={key} className={cn('flex items-start gap-2 rounded-lg border border-border p-2', got && 'opacity-60')}>
              <input type="checkbox" checked={got} onChange={() => toggle(game.id, 'items', key)} aria-label={`Collected ${file.items[it.item]?.name ?? it.item}`} className="mt-1 size-4 accent-[var(--color-accent)]" />
              <ItemSprite itemId={it.item} size={28} />
              <div className="min-w-0 flex-1">
                <button type="button" className="text-sm font-semibold hover:text-accent hover:underline" onClick={() => openItem(it.item)}>
                  {file.items[it.item]?.name ?? it.item}
                  {it.qty > 1 ? ` ×${it.qty}` : ''}
                </button>
                <p className="text-xs text-muted">
                  <Chip className="mr-1 h-5">{HOW_LABEL[it.how]}</Chip>
                  {it.where}
                  {it.requires ? ` · needs ${it.requires}` : ''} · {it.respawns ? 'respawns' : 'one-time'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {loc.shops.length > 0 && <p className="text-xs text-muted">Shop stock is on the Overview tab.</p>}
    </div>
  );
}

function Npcs({ loc }: { loc: AtlasLocation }) {
  const { file, speciesName, openItem } = useAtlasCtx();
  const people = loc.npcs.filter((n) => n.role !== 'sign');
  const signs = loc.npcs.filter((n) => n.role === 'sign');
  if (!loc.npcs.length) return <EmptyState icon={Users} title="Nobody to talk to">No NPCs are placed on this location’s maps.</EmptyState>;
  const row = (n: AtlasNpc, i: number) => (
    <li key={i} className="rounded-lg border border-border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <b>{n.name}</b>
        <span className="text-xs text-muted">{n.sprite}{n.sub ? ` · ${n.sub}` : ''}</span>
        {n.role && n.role !== 'npc' && n.role !== 'sign' && <Chip tone="accent" icon={n.role === 'gift' ? Gift : undefined}>{n.role}</Chip>}
      </div>
      {n.says.map((t, j) => <p key={j} className="mt-1 whitespace-pre-line text-muted">“{t}”</p>)}
      {n.gives?.map((g, j) => (
        <div key={j} className="mt-1 flex items-center gap-1 text-xs">
          <Gift size={12} aria-hidden /> Gives
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" onClick={() => openItem(g.item)}>
            <ItemSprite itemId={g.item} size={16} />
            {file.items[g.item]?.name ?? g.item}{g.qty > 1 ? ` ×${g.qty}` : ''}
          </button>
        </div>
      ))}
      {n.giftMon && <p className="mt-1 text-xs">Gift Pokémon: <b>{speciesName(n.giftMon.species)}</b> Lv {n.giftMon.level}{n.giftMon.item ? ` holding ${file.items[n.giftMon.item]?.name ?? n.giftMon.item}` : ''}</p>}
      {n.trade && <p className="mt-1 text-xs">Trade: your <b>{speciesName(n.trade.give)}</b> for <b>{n.trade.nickname ? `${n.trade.nickname} the ` : ''}{speciesName(n.trade.get)}</b>{n.trade.item ? ` holding ${file.items[n.trade.item]?.name ?? n.trade.item}` : ''}</p>}
    </li>
  );
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">{people.map(row)}</ul>
      {signs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Signposts ({signs.length})</summary>
          <ul className="mt-1.5 space-y-1.5">{signs.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

export function WildList({ rows }: { rows: WildRow[] }) {
  const { dex, format, speciesName } = useAtlasCtx();
  const setView = useTeamStore((s) => s.setView);
  const byMethod = useMemo(() => {
    const m = new Map<string, WildRow[]>();
    for (const r of rows) (m.get(r.method) ?? m.set(r.method, []).get(r.method)!).push(r);
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="space-y-3">
      {byMethod.map(([method, list]) => (
        <Section key={method} title={method}>
          <ul className="space-y-0.5">
            {list.sort((a, b) => b.rate - a.rate).map((r, i) => {
              const sp = dex.species(r.species);
              return (
                <li key={i} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
                  <Sprite speciesId={r.species} name={speciesName(r.species)} types={sp?.types} set={format.spriteSet} size={32} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-accent hover:underline"
                    onClick={() => {
                      usePokedexStore.getState().select('gen4', r.species);
                      usePokedexStore.getState().setTab('info');
                      setView('dex');
                    }}
                    title="Open in the Pokédex"
                  >
                    {speciesName(r.species)}
                  </button>
                  <span className="flex flex-wrap justify-end gap-1">
                    {r.sub && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">{r.sub}</span>}
                    {r.conditions.map((c) => <span key={c} className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">{c}</span>)}
                  </span>
                  <span className="w-16 text-right font-mono text-xs tabular-nums">Lv {r.min === r.max ? r.min : `${r.min}–${r.max}`}</span>
                  <span className="w-10 text-right font-mono text-xs tabular-nums">{r.rate ? `${r.rate}%` : ''}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function Wild({ rows, loading }: { rows: WildRow[]; loading: boolean }) {
  if (loading) return <div className="h-24 animate-pulse rounded-lg bg-surface-2" />;
  if (!rows.length) return <EmptyState icon={CircleDot} title="No wild Pokémon">No wild encounter table lists this location in Platinum.</EmptyState>;
  return <WildList rows={rows} />;
}

export function TrainerList({ ids }: { ids: string[] }) {
  const { file, dex, format, openTrainer, game } = useAtlasCtx();
  const progress = useProgress(game.id);
  const toggle = useAtlasStore((s) => s.toggle);
  // One row per trainer (first battle); rematches and variants live in the detail's version tabs.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return ids.map((id) => file.trainers[id]).filter((t) => t && !seen.has(t.group) && seen.add(t.group));
  }, [ids, file]);
  if (!rows.length) return <EmptyState icon={Swords} title="No trainers">No trainer battles happen in this location.</EmptyState>;
  return (
    <ul className="space-y-1">
      {rows.map((t) => {
        const beaten = progress.trainers.includes(t.group);
        return (
          <li key={t.id} className={cn('flex items-center gap-2 rounded-lg border border-border p-1.5', beaten && 'opacity-60')}>
            <input type="checkbox" checked={beaten} onChange={() => toggle(game.id, 'trainers', t.group)} aria-label={`Beaten ${t.name}`} className="size-4 accent-[var(--color-accent)]" />
            <button type="button" onClick={() => openTrainer(t.group)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t.cls === t.name ? t.name : `${t.cls} ${t.name}`}</span>
                <span className="text-[11px] text-muted">{KIND_LABEL[t.kind]}{t.double ? ' · double' : ''} · {trainerVariantCount(file.trainers, t.group)} battle{trainerVariantCount(file.trainers, t.group) > 1 ? 's' : ''}</span>
              </span>
              <span className="flex shrink-0">
                {t.party.map((m, i) => <Sprite key={i} speciesId={m.species} name={m.species} types={dex.species(m.species)?.types} set={format.spriteSet} size={28} className="-ml-2 first:ml-0" />)}
              </span>
              <span className="w-12 shrink-0 text-right font-mono text-xs text-muted">Lv {Math.max(...t.party.map((m) => m.level))}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function trainerVariantCount(trainers: Record<string, { group: string }>, group: string) {
  return Object.values(trainers).filter((t) => t.group === group).length;
}

function Notes({ loc }: { loc: AtlasLocation }) {
  const { file } = useAtlasCtx();
  const gifts = loc.npcs.filter((n) => n.giftMon);
  const unverified = loc.trainers.flatMap((id) => file.unverified[id] ?? []);
  return (
    <div className="space-y-3 text-sm">
      {loc.events.length > 0 && <ul className="list-disc space-y-1 pl-5">{loc.events.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {gifts.length > 0 && (
        <Section title="Gift and static Pokémon">
          <ul className="space-y-1">
            {gifts.map((n, i) => <li key={i}>{n.name}: Lv {n.giftMon!.level} {n.giftMon!.species}</li>)}
          </ul>
        </Section>
      )}
      {unverified.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">Unverified here: {unverified.join('; ')}</p>
      )}
      {!loc.events.length && !gifts.length && !unverified.length && (
        <EmptyState icon={BookOpen} title="No notes">No berry patches, gifts or static encounters are recorded for this location. Story triggers are not listed in a readable form in the game data.</EmptyState>
      )}
    </div>
  );
}
