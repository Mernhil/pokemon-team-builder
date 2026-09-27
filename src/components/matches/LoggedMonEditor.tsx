import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import type { LoggedMon } from '@/domain/matches';
import type { FormatRules } from '@/domain/types';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { Combobox, type ComboOption } from '../ui/Combobox';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, cn } from '../ui/primitives';

const TERA_TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Stellar'];

/**
 * One logged Pokémon (mine or the opponent's): species is the only required field — Team Preview is
 * "quick mode". Item/ability/moves/Tera revealed during the game are optional and fold away so
 * entering a whole Team Preview stays a few taps, not a full set builder.
 */
export function LoggedMonEditor({ dex, format, mon, onChange, onRemove }: { dex: Dex; format: FormatRules; mon: LoggedMon; onChange: (m: LoggedMon) => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const species = dex.species(mon.speciesId);

  const itemOptions: ComboOption[] = dex.items().map((i) => ({
    id: i.id,
    label: i.name,
    render: (
      <span className="flex items-center gap-2">
        <ItemSprite itemId={i.id} name={i.name} size={18} />
        {i.name}
      </span>
    ),
  }));
  const abilityOptions: ComboOption[] = Object.values(dex.data.abilities).map((a) => ({ id: a.id, label: a.name }));
  const moveOptions: ComboOption[] = (mon.speciesId ? dex.learnset(mon.speciesId) : []).map((m) => ({ id: m.id, label: m.name }));

  const moves = mon.moves ?? [];
  const setMove = (i: number, id: string) => {
    const next = [...moves];
    next[i] = id;
    onChange({ ...mon, moves: next.filter(Boolean) });
  };

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2">
      <div className="flex items-center gap-2">
        <Sprite speciesId={mon.speciesId} name={species?.name} types={species?.types} set={format.spriteSet} size={36} />
        <div className="min-w-0 flex-1">
          <SpeciesPicker dex={dex} format={format} value={mon.speciesId || undefined} onChange={(id) => onChange({ ...mon, speciesId: id })} showGenFilter={false} placeholder="Species seen at Team Preview…" />
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={() => setExpanded((e) => !e)} aria-label="More details" aria-expanded={expanded}>
          <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Remove">
          <X size={14} />
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-border pt-2 sm:grid-cols-4">
          <Combobox aria-label="Item seen" options={itemOptions} value={mon.itemId} onChange={(id) => onChange({ ...mon, itemId: id })} allowClear placeholder="Item (optional)" />
          <Combobox aria-label="Ability seen" options={abilityOptions} value={mon.abilityId} onChange={(id) => onChange({ ...mon, abilityId: id })} allowClear placeholder="Ability (optional)" />
          <select
            aria-label="Tera type revealed"
            value={mon.teraType ?? ''}
            onChange={(e) => onChange({ ...mon, teraType: (e.target.value || undefined) as LoggedMon['teraType'] })}
            className="h-9 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-accent"
          >
            <option value="">Tera (optional)</option>
            {TERA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="col-span-2 grid grid-cols-2 gap-1.5 sm:col-span-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Combobox key={i} aria-label={`Move ${i + 1} seen`} options={moveOptions} value={moves[i]} onChange={(id) => setMove(i, id)} allowClear placeholder={`Move ${i + 1} seen`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
