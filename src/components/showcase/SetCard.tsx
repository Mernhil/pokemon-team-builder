import { Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { calcStats, spreadKey, sumStats } from '@/domain/stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type PokemonSet, type StatId } from '@/domain/types';
import { STAT_COLOR_VAR, TYPE_BADGE } from '../ui/color';
import { CATEGORY_ICON } from '../ui/categoryIcon';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { BenchmarkList } from '../editor/BenchmarkList';
import { Sprite } from '../ui/Sprite';
import { TypeBadge } from '../ui/primitives';
import { typeGradient } from '../ui/styles';

export type CardView = 'moves' | 'stats';

/** A stat is sized out of this for its bar (the highest finished stat at Lv 50 is around 250). */
const BAR_MAX = 255;

/** Two letters per type, so Fire / Fighting / Fairy (and the other first-letter pairs) read apart on a small chip. */
const ABBR: Record<string, string> = {
  Normal: 'Nm', Fire: 'Fi', Water: 'Wa', Electric: 'El', Grass: 'Gr', Ice: 'Ic', Fighting: 'Fg', Poison: 'Po', Ground: 'Gd',
  Flying: 'Fl', Psychic: 'Ps', Bug: 'Bu', Rock: 'Ro', Ghost: 'Gh', Dragon: 'Dr', Dark: 'Dk', Steel: 'St', Fairy: 'Fy', Stellar: 'Sl',
};

/** A small chip in a type's colour: a type icon that fits a phone-width card. */
function TypeDot({ type }: { type: Parameters<typeof TypeBadge>[0]['type'] }) {
  const { fill, text } = TYPE_BADGE[type];
  return (
    <span className="inline-flex h-4 min-w-5 shrink-0 items-center justify-center rounded-full px-0.5 text-[8px] leading-none font-bold" style={{ background: fill, color: text }} title={type} role="img" aria-label={type}>
      {ABBR[type] ?? type.slice(0, 2)}
    </span>
  );
}

/**
 * One Pokémon of a team, in two views like the in-game team screen: "Moves & More" (ability, item,
 * moves) and "Stats" (finished stats with their SP or EVs and the nature's raised and lowered stat).
 * Built to sit two to a row even on a phone, so a whole team fits one screen.
 */
export function SetCard({ dex, format, set, view, mega: showMega }: { dex: Dex; format: FormatRules; set: PokemonSet; view: CardView; mega: boolean }) {
  const species = dex.species(set.speciesId)!;
  const mech = formatMechanics(format);
  const mega = format.capabilities.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  const form = showMega && mega ? mega : species;
  const nature = mech.natures ? dex.nature(set.nature) : undefined;
  const key = spreadKey(format.statSystem);
  const spread = set[key];
  const stats = calcStats(form.baseStats, set, format, nature);
  const item = dex.item(set.itemId);
  // A Mega's own ability while Megas are shown (the set's if the data has none).
  const ability = dex.ability((showMega && mega ? Object.values(mega.abilities)[0] : undefined) ?? set.abilityId);
  const unit = key === 'sp' ? 'SP' : 'EVs';
  const nick = set.nickname && set.nickname !== species.name ? set.nickname : undefined;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface" aria-label={`${nick ?? species.name}, ${view === 'stats' ? 'stats' : 'moves'}`}>
      <header className="relative flex items-center gap-1.5 px-2 py-1" style={{ background: typeGradient(form.types) }}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30" aria-hidden />
        <Sprite speciesId={form.id} name={form.name} types={form.types} set={format.spriteSet} size={32} className="relative shrink-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.45)]" />
        <div className="relative min-w-0 flex-1 text-white">
          <h3 className="truncate text-[13px] leading-tight font-bold drop-shadow sm:text-sm">{nick ?? form.name}</h3>
          <div className="mt-0.5 flex items-center gap-1">
            {form.types.map((t) => (
              <TypeDot key={t} type={t} />
            ))}
            {mega && (
              <span className="ml-0.5 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase" title={showMega ? `${mega.name} (Mega)` : `Holds ${item?.name}: can Mega Evolve`}>
                <Sparkles size={9} aria-hidden /> {showMega ? 'Mega' : <span className="sr-only">Can Mega Evolve</span>}
              </span>
            )}
          </div>
        </div>
      </header>

      {view === 'moves' ? (
        <div className="space-y-1 p-1.5 text-[11px] leading-tight sm:p-2 sm:text-xs">
          <dl className="space-y-0.5">
            {mech.abilities && (
              <div className="flex items-center gap-1.5" title={ability?.shortDesc}>
                <dt className="sr-only">Ability</dt>
                <dd className="truncate font-medium">{ability?.name ?? '—'}</dd>
              </div>
            )}
            {(mech.heldItems || mech.megaStoneOnly) && (
              <div className="flex items-center gap-1.5" title={item?.shortDesc}>
                <dt className="sr-only">Item</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  {item ? (
                    <>
                      <ItemSprite itemId={item.id} name={item.name} size={16} />
                      <span className="truncate">{item.name}</span>
                    </>
                  ) : (
                    <span className="text-muted">No item</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <ul className="space-y-0.5 border-t border-border pt-1" aria-label="Moves">
            {set.moves.map((id, i) => {
              const mv = id ? dex.move(id) : undefined;
              if (!mv) return null;
              const Icon = CATEGORY_ICON[mv.category];
              return (
                <li key={i}>
                  <MoveTooltip move={mv} className="flex w-full">
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      <TypeDot type={mv.type} />
                      <span className="min-w-0 flex-1 truncate">{mv.name}</span>
                      <Icon size={11} className="hidden shrink-0 text-muted sm:block" aria-label={mv.category} />
                      <span className="hidden w-7 shrink-0 text-right font-mono text-[10px] text-muted sm:block">{mv.basePower || '—'}</span>
                    </span>
                  </MoveTooltip>
                </li>
              );
            })}
          </ul>
          {set.notes && <p className="border-t border-border pt-1 whitespace-pre-wrap text-muted">{set.notes}</p>}
        </div>
      ) : (
        <div className="p-1.5 sm:p-2">
          <table className="w-full text-[11px] sm:text-xs">
            <caption className="sr-only">
              Finished stats{showMega && mega ? ` of ${mega.name}` : ''} and {unit}
            </caption>
            <tbody>
              {STAT_IDS.map((s: StatId) => {
                const mod = nature && s !== 'hp' && nature.plus !== nature.minus ? (nature.plus === s ? 'up' : nature.minus === s ? 'down' : '') : '';
                return (
                  <tr key={s}>
                    <th scope="row" className="w-11 py-px text-left font-semibold whitespace-nowrap sm:w-14" style={{ color: STAT_COLOR_VAR[s] }}>
                      {STAT_LABELS[s]}
                      {mod && (
                        <span className={mod === 'up' ? 'text-bad' : 'text-accent'} role="img" aria-label={mod === 'up' ? 'raised by nature' : 'lowered by nature'}>
                          {mod === 'up' ? '▲' : '▼'}
                        </span>
                      )}
                    </th>
                    <td className="w-8 py-px text-right font-mono font-bold tabular-nums">{stats[s]}</td>
                    <td className="px-1.5 py-px">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (stats[s] / BAR_MAX) * 100)}%`, background: STAT_COLOR_VAR[s] }} />
                      </span>
                    </td>
                    <td className="w-5 py-px text-right font-mono text-muted tabular-nums" title={`${spread[s]} ${unit}`}>
                      {spread[s]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-0.5 hidden text-right text-[10px] text-muted sm:block">{sumStats(spread)} {unit} used</p>
          {set.benchmarks?.length ? (
            <div className="mt-1.5 border-t border-border pt-1.5">
              <BenchmarkList dex={dex} format={format} set={set} />
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
