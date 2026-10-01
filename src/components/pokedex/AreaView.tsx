import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, MapPin } from 'lucide-react';
import { ATLAS_GAMES } from '@/domain/atlas';
import { useAtlasStore } from '@/store/atlasStore';
import { useTeamStore } from '@/store/teamStore';
import type { Dex } from '@/data/dex';
import type { DexBook } from '@/domain/games';
import { evolutionMethod, type Encounter, type PokedexData } from '@/domain/pokedex';
import type { Pokemon } from '@/domain/types';
import { usePokedexStore } from '@/store/pokedexStore';
import { Panel } from '../ui/primitives';
import { cn } from '../ui/styles';
import { RegionMaps } from './RegionMap';

interface Props {
  species: Pokemon;
  data: PokedexData;
  book: DexBook;
  encounters: Encounter[];
  dex: Dex;
}

/**
 * The Pokédex "Area" page: pick a game, see where the Pokémon lives on that game's region map,
 * then the detail per location (method, levels, rate, time of day / season / Swarm…).
 */
export function AreaView({ species, data, book, encounters, dex }: Props) {
  const stored = usePokedexStore((s) => s.game[book.id]);
  const { setGame } = usePokedexStore.getState();
  const gamesWith = new Set(encounters.map((e) => e.game.id));
  const game = data.games.find((g) => g.id === stored) ?? data.games.find((g) => gamesWith.has(g.id)) ?? data.games[0];
  const here = encounters.filter((e) => e.game.id === game.id);

  // Group by location, then by sub-area.
  const byLocation = useMemo(() => {
    const m = new Map<string, { name: string; rows: Encounter[] }>();
    for (const e of here) {
      const g = m.get(e.area.loc) ?? { name: e.area.name, rows: [] };
      g.rows.push(e);
      m.set(e.area.loc, g);
    }
    return [...m.entries()];
  }, [here]);

  // Games with a Pokénav link each location to the interactive map with the spot highlighted.
  const atlasGame = ATLAS_GAMES.find((a) => a.available && a.dexGame === game.id);
  const prevo = species.prevo ? dex.species(species.prevo) : undefined;

  // The location picked on the map (or in the list): highlighted in both.
  const scope = `${species.id}:${game.id}`;
  const [pickedLoc, setPickedLoc] = useState({ scope, loc: '' });
  const selected = pickedLoc.scope === scope ? pickedLoc.loc : '';
  const setSelected = (loc: string) => setPickedLoc({ scope, loc });
  useEffect(() => {
    if (selected) document.getElementById(`area-loc-${selected}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Game">
        {data.games.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={g.id === game.id}
            onClick={() => setGame(book.id, g.id)}
            className={cn(
              'h-8 rounded-md border px-2.5 text-xs font-semibold transition-colors',
              g.id === game.id ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-fg',
              !gamesWith.has(g.id) && g.id !== game.id && 'opacity-50',
            )}
          >
            {g.name}
            {gamesWith.has(g.id) && <MapPin size={11} className="ml-1 inline" />}
          </button>
        ))}
      </div>

      <RegionMaps game={game.id} encounters={here} selected={selected} onSelect={setSelected} />

      {here.length ? (
        <Panel title={`Where to find ${species.name}`} actions={<span className="text-xs text-muted">{game.name}</span>}>
          <div className="space-y-3">
            {byLocation.map(([loc, g]) => (
              <div key={loc} id={`area-loc-${loc}`} className={cn('-mx-2 scroll-mt-4 rounded-lg px-2 py-1 transition-colors', selected === loc && 'bg-accent/10 ring-1 ring-accent/40')}>
                <h3 className="mb-1 text-sm font-semibold">
                  <button
                    type="button"
                    aria-pressed={selected === loc}
                    onClick={() => setSelected(selected === loc ? '' : loc)}
                    className="hit inline-flex items-center gap-1.5 rounded text-left hover:text-accent"
                    title="Show on the map"
                  >
                    <MapPin size={13} className="text-accent" aria-hidden /> {g.name}
                  </button>
                  {atlasGame && (
                    <button
                      type="button"
                      className="hit ml-2 inline-flex items-center gap-1 rounded text-xs font-semibold text-accent hover:underline"
                      onClick={() => {
                        useAtlasStore.getState().setFocus({ game: atlasGame.id, loc });
                        useTeamStore.getState().setView('atlas');
                      }}
                    >
                      <MapIcon size={12} aria-hidden /> Show in Pokénav
                    </button>
                  )}
                </h3>
                <div className="-mx-1 overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {g.rows.map((e, i) => (
                        <tr key={i} className="border-t border-border/60 align-top">
                          <td className="w-28 px-1 py-1 text-muted">{e.area.sub ?? ''}</td>
                          <td className="px-1 py-1">{e.method}</td>
                          <td className="w-20 px-1 py-1 text-right font-mono tabular-nums">
                            Lv {e.minLevel === e.maxLevel ? e.minLevel : `${e.minLevel}–${e.maxLevel}`}
                          </td>
                          <td className="w-12 px-1 py-1 text-right font-mono tabular-nums">{e.rate ? `${e.rate}%` : ''}</td>
                          <td className="px-1 py-1">
                            <span className="flex flex-wrap gap-1">
                              {e.conditions.map((c) => (
                                <span key={c} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                                  {c}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel title="Area unknown">
          <p className="text-sm text-muted">
            {!Object.keys(data.encounters).length
              ? `There are no wild encounter tables for ${book.games} yet, so this Pokédex has no Area data.`
              : `${species.name} can't be found in the wild in ${game.name}.`}
            {prevo && (
              <>
                {' '}
                Evolve{' '}
                <button type="button" className="font-semibold text-accent hover:underline" onClick={() => usePokedexStore.getState().select(book.id, prevo.id)}>
                  {prevo.name}
                </button>{' '}
                ({evolutionMethod(species).toLowerCase()}).
              </>
            )}
            {!prevo && gamesWith.size > 0 && ` It appears in ${data.games.filter((g) => gamesWith.has(g.id)).map((g) => g.name).join(', ')}.`}
            {!prevo && gamesWith.size === 0 && Object.keys(data.encounters).length > 0 && ' It has to be traded in, bred, hatched or received as a gift or event.'}
          </p>
        </Panel>
      )}
    </div>
  );
}
