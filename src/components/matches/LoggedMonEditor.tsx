import { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import type { LoggedMon } from '@/domain/matches';
import type { FormatRules } from '@/domain/types';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { Combobox, type ComboOption } from '../ui/Combobox';
import { comboProps, useItemPicker, useMovePicker } from '../editor/options';
import { Sprite } from '../ui/Sprite';
import { Button } from '../ui/primitives';
import { cn } from '../ui/styles';

const TERA_TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy', 'Stellar'];

/**
 * One logged Pokémon (mine or the opponent's): species is the only required field — Team Preview is
 * "quick mode". Item/ability/moves/Tera revealed during the game are optional and fold away so
 * entering a whole Team Preview stays a few taps, not a full set builder.
 */
export function LoggedMonEditor({
  dex,
  format,
  tera,
  mon,
  onChange,
  onRemove,
}: {
  dex: Dex;
  format: FormatRules;
  /** Whether the match's game has Terastallization (only then is a revealed Tera Type offered). */
  tera: boolean;
  mon: LoggedMon;
  onChange: (m: LoggedMon) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const species = dex.species(mon.speciesId);

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
      {expanded && <LoggedMonDetails dex={dex} format={format} tera={tera} mon={mon} onChange={onChange} />}
    </div>
  );
}

/**
 * Item/ability/moves/Tera revealed in battle — only mounted once a row is expanded (a Team Preview
 * has up to 12 of these editors), with the same ordered pickers as the builder.
 */
function LoggedMonDetails({ dex, format, tera, mon, onChange }: { dex: Dex; format: FormatRules; tera: boolean; mon: LoggedMon; onChange: (m: LoggedMon) => void }) {
  const moves = mon.moves ?? [];
  const itemPicker = useItemPicker(dex, format, mon.speciesId);
  const movePicker = useMovePicker(dex, format, mon.speciesId ? { speciesId: mon.speciesId, itemId: mon.itemId, moves: [moves[0] ?? '', moves[1] ?? '', moves[2] ?? '', moves[3] ?? ''] } : null);
  // A species can only have its own abilities (slot 1, slot 2, Hidden).
  const abilityOptions = useMemo<ComboOption[]>(
    () => dex.abilitiesOf(mon.speciesId).map(({ slot, ability }) => ({ id: ability.id, label: slot === 'H' ? `${ability.name} (Hidden)` : ability.name })),
    [dex, mon.speciesId],
  );
  const setMove = (i: number, id: string) => {
    movePicker.remember(id);
    const next = [...moves];
    next[i] = id;
    onChange({ ...mon, moves: next.filter(Boolean) });
  };

  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-border pt-2 sm:grid-cols-4">
      <Combobox
        aria-label="Item seen"
        {...comboProps(itemPicker)}
        value={mon.itemId}
        onChange={(id) => {
          itemPicker.remember(id);
          onChange({ ...mon, itemId: id || undefined });
        }}
        allowClear
        placeholder="Item (optional)"
      />
      <Combobox aria-label="Ability seen" options={abilityOptions} value={mon.abilityId} onChange={(id) => onChange({ ...mon, abilityId: id || undefined })} allowClear placeholder="Ability (optional)" />
      {tera && (
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
      )}
      <div className="col-span-2 grid grid-cols-2 gap-1.5 sm:col-span-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Combobox key={i} aria-label={`Move ${i + 1} seen`} {...comboProps(movePicker)} value={moves[i]} onChange={(id) => setMove(i, id)} allowClear placeholder={`Move ${i + 1} seen`} />
        ))}
      </div>
    </div>
  );
}
