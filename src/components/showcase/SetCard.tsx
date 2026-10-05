import { Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { calcStats, spreadKey, sumStats } from '@/domain/stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type PokemonSet, type StatId } from '@/domain/types';
import { STAT_COLOR_VAR } from '../ui/color';
import { CATEGORY_ICON } from '../ui/categoryIcon';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { TypeBadge } from '../ui/primitives';
import { typeGradient } from '../ui/styles';

/** A stat is shown out of this to size its bar (the highest finished stat at Lv 50 is around 250). */
const BAR_MAX = 255;

/** One Pokémon of a team, the way a team showcase shows it: who, item, ability, nature, moves and finished stats. */
export function SetCard({ dex, format, set }: { dex: Dex; format: FormatRules; set: PokemonSet }) {
  const species = dex.species(set.speciesId)!;
  const mech = formatMechanics(format);
  const mega = format.capabilities.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  const nature = mech.natures ? dex.nature(set.nature) : undefined;
  const key = spreadKey(format.statSystem);
  const spread = set[key];
  const stats = calcStats(species.baseStats, set, format, nature);
  const megaStats = mega ? calcStats(mega.baseStats, set, format, nature) : undefined;
  const item = dex.item(set.itemId);
  const ability = dex.ability(set.abilityId);
  const unit = key === 'sp' ? 'SP' : 'EVs';
  const nick = set.nickname && set.nickname !== species.name ? set.nickname : undefined;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface" aria-label={nick ?? species.name}>
      <header className="relative flex items-center gap-3 p-3" style={{ background: typeGradient(species.types) }}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/30" aria-hidden />
        <Sprite speciesId={species.id} name={species.name} types={species.types} set={format.spriteSet} size={72} className="relative drop-shadow-[0_3px_4px_rgb(0_0_0/0.45)]" />
        <div className="relative min-w-0 flex-1 text-white">
          <h3 className="truncate text-base font-bold drop-shadow">{nick ?? species.name}</h3>
          {nick && <p className="truncate text-xs opacity-90">{species.name}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {species.types.map((t) => (
              <TypeBadge key={t} type={t} size="xs" />
            ))}
          </div>
        </div>
        {mega && (
          <div className="relative flex flex-col items-center text-white" title={mega.name}>
            <Sprite speciesId={mega.id} name={mega.name} types={mega.types} set={format.spriteSet} size={48} className="drop-shadow-[0_3px_4px_rgb(0_0_0/0.45)]" />
            <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase">
              <Sparkles size={10} aria-hidden /> Mega
            </span>
          </div>
        )}
      </header>

      <div className="space-y-3 p-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {(mech.heldItems || mech.megaStoneOnly) && (
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Item</dt>
              <dd className="flex items-center gap-1.5 truncate">
                {item ? (
                  <>
                    <ItemSprite itemId={item.id} name={item.name} size={18} />
                    <span className="truncate">{item.name}</span>
                  </>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </dd>
            </div>
          )}
          {mech.abilities && (
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Ability</dt>
              <dd className="truncate" title={ability?.shortDesc}>{ability?.name ?? '—'}</dd>
            </div>
          )}
          {nature && (
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Nature</dt>
              <dd className="truncate">
                {nature.name}
                {nature.plus && nature.minus && nature.plus !== nature.minus && <span className="text-muted"> (+{STAT_LABELS[nature.plus]} −{STAT_LABELS[nature.minus]})</span>}
              </dd>
            </div>
          )}
          {mega && (
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{mega.name}</dt>
              <dd className="truncate text-muted">
                {mega.types.join('/')} · {Object.values(mega.abilities)[0]}
              </dd>
            </div>
          )}
        </dl>

        <ul className="space-y-1" aria-label="Moves">
          {set.moves.map((id, i) => {
            const mv = id ? dex.move(id) : undefined;
            if (!mv) return null;
            const Icon = CATEGORY_ICON[mv.category];
            return (
              <li key={i}>
                <MoveTooltip move={mv} className="flex w-full">
                  <span className="flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1">
                    <TypeBadge type={mv.type} size="xs" />
                    <span className="min-w-0 flex-1 truncate font-medium">{mv.name}</span>
                    <Icon size={12} className="shrink-0 text-muted" aria-label={mv.category} />
                    <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted">{mv.basePower || '—'}</span>
                  </span>
                </MoveTooltip>
              </li>
            );
          })}
        </ul>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-muted">
            <span>Stats · {unit}{megaStats ? ' · Mega' : ''}</span>
            <span className="font-mono normal-case tracking-normal">{sumStats(spread)} {unit} used</span>
          </div>
          <table className="w-full text-xs">
            <caption className="sr-only">Finished stats and {unit}</caption>
            <tbody>
              {STAT_IDS.map((s: StatId) => {
                const mod = nature && s !== 'hp' ? (nature.plus === s && nature.plus !== nature.minus ? '+' : nature.minus === s && nature.plus !== nature.minus ? '−' : '') : '';
                return (
                  <tr key={s}>
                    <th scope="row" className="w-9 py-0.5 text-left font-semibold" style={{ color: STAT_COLOR_VAR[s] }}>
                      {STAT_LABELS[s]}
                      {mod && <span aria-label={mod === '+' ? 'raised by nature' : 'lowered by nature'}>{mod}</span>}
                    </th>
                    <td className="w-9 py-0.5 text-right font-mono tabular-nums font-bold">{stats[s]}</td>
                    <td className="px-2 py-0.5">
                      <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (stats[s] / BAR_MAX) * 100)}%`, background: STAT_COLOR_VAR[s] }} />
                      </span>
                    </td>
                    <td className="w-10 py-0.5 text-right font-mono tabular-nums text-muted" title={`${spread[s]} ${unit}`}>
                      {spread[s] || ''}
                    </td>
                    {megaStats && (
                      <td className="w-10 py-0.5 text-right font-mono tabular-nums text-accent" title={`${mega?.name} ${STAT_LABELS[s]}`}>
                        {megaStats[s]}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}
