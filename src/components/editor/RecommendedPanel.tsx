import { Check, Lightbulb } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { usageText } from '@/domain/meta';
import type { Recommendation } from '@/domain/recommend';
import { STAT_IDS, STAT_LABELS, type PokemonSet } from '@/domain/types';
import { toast } from '@/store/toastStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Button, Disclosure } from '../ui/primitives';
import { InfoTooltip } from '../ui/InfoTooltip';
import { cn } from '../ui/styles';
import { useRecommended } from './useRecommended';
import type { FormatRules } from '@/domain/types';

const pct = (n: number) => `${Math.round(n)}%`;

/**
 * "Recommended way to use": what people actually run on this Pokémon (from the meta data): its most
 * common items, ability, nature and spread, and moves, with one tap to take an item or the whole build.
 */
export function RecommendedPanel({ dex, format, set, onApply }: { dex: Dex; format: FormatRules; set: PokemonSet; onApply: (patch: Partial<PokemonSet>) => void }) {
  const { rec, reg } = useRecommended(dex, format, set.speciesId);
  return rec ? <RecommendedBody dex={dex} rec={rec} reg={reg} set={set} onApply={onApply} /> : null;
}

/** The info button next to the item field: the most-used items, as a hover / tap card. */
export function RecommendedItemsInfo({ dex, format, speciesId }: { dex: Dex; format: FormatRules; speciesId: string }) {
  const { rec, reg } = useRecommended(dex, format, speciesId);
  if (!rec || rec.items.length === 0) return null;
  const name = dex.species(speciesId)?.name ?? speciesId;
  return (
    <InfoTooltip
      title="Recommended items"
      summary={`Most used on ${name}${reg ? ` in ${reg}` : ''}`}
      effects={rec.items.map((i) => `${i.name}: ${Math.round(i.pct)}%`)}
      label={`Recommended items for ${name}`}
    >
      <span className="inline-flex size-6 items-center justify-center text-accent">
        <Lightbulb size={14} aria-hidden />
      </span>
    </InfoTooltip>
  );
}

function RecommendedBody({
  dex,
  rec,
  reg,
  set,
  onApply,
}: {
  dex: Dex;
  rec: Recommendation;
  reg?: string;
  set: PokemonSet;
  onApply: (patch: Partial<PokemonSet>) => void;
}) {
  const name = dex.species(rec.speciesId)?.name ?? rec.speciesId;
  const top = rec.spreads[0];
  const build = rec.set?.set;

  const useBuild = () => {
    if (!build) return;
    const before: Partial<PokemonSet> = { itemId: set.itemId, abilityId: set.abilityId, nature: set.nature, sp: set.sp, moves: set.moves };
    onApply({ itemId: build.itemId, abilityId: build.abilityId, nature: build.nature, sp: build.sp, moves: build.moves });
    toast(`Applied the most-used ${name} build.`, { label: 'Undo', run: () => onApply(before) });
  };

  return (
    <Disclosure
      title={
        <span className="flex items-center gap-1.5">
          <Lightbulb size={14} className="text-accent" aria-hidden /> Recommended way to use
        </span>
      }
      summary={`${name} · ${usageText(rec)}${reg ? ` · ${reg}` : ''}`}
    >
      <div className="space-y-3 pt-1 text-sm">
        {rec.items.length > 0 && (
          <section aria-label="Recommended items">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Items</h3>
            <ul className="flex flex-wrap gap-1.5">
              {rec.items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    aria-pressed={set.itemId === i.id}
                    onClick={() => onApply({ itemId: i.id })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs pointer-coarse:min-h-11',
                      set.itemId === i.id ? 'border-accent bg-accent/15 font-semibold' : 'border-border bg-surface-2 hover:bg-surface',
                    )}
                  >
                    <ItemSprite itemId={i.id} name={i.name} size={16} />
                    {i.name}
                    <span className="text-muted">{pct(i.pct)}</span>
                    {set.itemId === i.id && <Check size={12} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {rec.abilities.length > 0 && (
            <section aria-label="Recommended ability">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Ability</h3>
              <p>{rec.abilities.map((a) => `${a.name} ${pct(a.pct)}`).join(' · ')}</p>
            </section>
          )}
          {top && (
            <section aria-label="Recommended spread">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Nature and spread{top.pct ? ` (${pct(top.pct)})` : ''}</h3>
              <p>
                <b>{top.nature}</b>
                <span className="ml-2 font-mono text-xs text-muted">{STAT_IDS.map((s, i) => `${STAT_LABELS[s]} ${top.values[i]}`).join(' · ')}</span>
              </p>
            </section>
          )}
        </div>
        {rec.moves.length > 0 && (
          <section aria-label="Recommended moves">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Moves</h3>
            <p>{rec.moves.map((m) => `${m.name} ${pct(m.pct)}`).join(' · ')}</p>
          </section>
        )}
        {build && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={useBuild}>
              Use the most-used build
            </Button>
            <span className="text-xs text-muted">Sets the item, ability, nature, spread and moves; Undo puts yours back.</span>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
