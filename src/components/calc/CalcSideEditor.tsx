import { Crosshair, Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultSide } from '@/domain/battle/conditions';
import { createSet } from '@/domain/team';
import { STAT_LABELS, TYPE_NAMES, type FormatRules, type Team, type TeraType } from '@/domain/types';
import { useCalcStore, type SideKey } from '@/store/calcStore';
import { SideControls } from '../battle/Controls';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { StatDistributor } from '../editor/StatDistributor';
import { useItemOptions, useMoveOptions } from '../editor/options';
import { Combobox } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Field, Panel, Select, TypeBadge, cn } from '../ui/primitives';
import { setSpreadValue } from '@/domain/stats';

interface Props {
  role: SideKey;
  dex: Dex;
  format: FormatRules;
  team: Team;
}

/** One side of the damage calculator — same building blocks as the team editor. */
export function CalcSideEditor({ role, dex, format, team }: Props) {
  const side = useCalcStore((s) => s[role]);
  const { setSide, patchSet, patchCond, patchSide } = useCalcStore.getState();
  const set = side.set;
  const itemOptions = useItemOptions(dex, format, set?.speciesId);
  const moveOptions = useMoveOptions(dex, format, set);
  const species = set ? dex.species(set.speciesId) : undefined;
  const mega = set ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  const forme = side.cond.mega && mega ? mega : species;

  const loadFromTeam = (i: number) => {
    const s = team.slots[i];
    if (!s) return;
    const hasMega = !!dex.megaFor(s.speciesId, s.itemId);
    setSide(role, {
      set: structuredClone(s),
      cond: defaultSide(hasMega),
      crits: [false, false, false, false],
      origin: { teamName: team.name, slot: i },
    });
  };

  const title = role === 'attacker' ? 'Attacker' : 'Defender';
  const sys = format.statSystem;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', role === 'attacker' ? 'bg-bad' : 'bg-accent')} />
          {title}
          {side.origin && (
            <span className="text-[11px] font-normal text-muted">
              from {side.origin.teamName} · slot {side.origin.slot + 1}
            </span>
          )}
        </span>
      }
    >
      <div className="space-y-4">
        {/* Quick load from the active team */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Load from {team.name}</div>
          <div className="flex flex-wrap gap-1">
            {team.slots.map((s, i) => {
              const sp = s && dex.species(s.speciesId);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!sp}
                  onClick={() => loadFromTeam(i)}
                  title={sp ? `Load ${sp.name}` : 'Empty slot'}
                  className={cn(
                    'rounded-lg border p-0.5 transition-colors disabled:opacity-30',
                    s && set && s.uid === set.uid ? 'border-accent bg-accent/10' : 'border-border hover:border-muted/60',
                  )}
                >
                  {sp ? <Sprite speciesId={sp.id} name={sp.name} types={sp.types} set={format.spriteSet} size={36} /> : <div className="h-9 w-9" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Identity */}
        <div className="flex items-start gap-3">
          {forme ? (
            <Sprite speciesId={forme.id} name={forme.name} types={forme.types} set={format.spriteSet} size={72} backdrop />
          ) : (
            <div className="h-[72px] w-[72px] rounded-xl bg-surface-2" />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <SpeciesPicker
              showGenFilter={!set}
              dex={dex}
              format={format}
              value={set?.speciesId}
              onChange={(id) => {
                if (!id) return;
                const next = createSet(dex, id, format);
                setSide(role, { set: next, cond: defaultSide(false), crits: [false, false, false, false] });
              }}
            />
            {forme && (
              <div className="flex flex-wrap items-center gap-1">
                {forme.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
                <GenBadge gen={forme.gen} size="xs" className="ml-1" />
                {forme !== species && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-accent">
                    <Sparkles size={11} /> {forme.name}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {set && species && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Held item">
                <Combobox
                  aria-label={`${title} item`}
                  options={itemOptions}
                  value={set.itemId}
                  allowClear
                  placeholder="None"
                  icon={<ItemSprite itemId={set.itemId} name={dex.item(set.itemId)?.name} size={18} />}
                  onChange={(id) => patchSet(role, { itemId: id || undefined })}
                />
              </Field>
              <Field label="Ability">
                <Select value={set.abilityId ?? ''} onChange={(e) => patchSet(role, { abilityId: e.target.value })} disabled={forme !== species} title={forme !== species ? 'Mega Evolution sets the ability' : undefined}>
                  {forme !== species ? (
                    <option>{Object.values(forme!.abilities)[0]}</option>
                  ) : (
                    dex.abilitiesOf(species.id).map(({ slot, ability }) => (
                      <option key={slot} value={ability.id}>
                        {ability.name}
                        {slot === 'H' ? ' (Hidden)' : ''}
                      </option>
                    ))
                  )}
                </Select>
              </Field>
              <Field label="Stat Alignment">
                <Select value={set.nature} onChange={(e) => patchSet(role, { nature: e.target.value })}>
                  {dex.natures.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                      {n.plus && n.plus !== n.minus ? ` (+${STAT_LABELS[n.plus]} −${STAT_LABELS[n.minus!]})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {format.gimmicks.tera && (
                <Field label="Tera Type">
                  <Select value={set.teraType ?? ''} onChange={(e) => patchSet(role, { teraType: (e.target.value || undefined) as TeraType | undefined })}>
                    <option value="">—</option>
                    {[...TYPE_NAMES, 'Stellar'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            {/* Moves + crit toggles */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Moves</div>
              <div className="grid grid-cols-1 gap-2">
                {set.moves.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Combobox
                      className="flex-1"
                      aria-label={`${title} move ${i + 1}`}
                      options={moveOptions}
                      value={m}
                      allowClear
                      placeholder="Search moves…"
                      onChange={(id) => {
                        const moves = [...set.moves] as typeof set.moves;
                        moves[i] = id;
                        patchSet(role, { moves });
                      }}
                    />
                    {m && dex.move(m) && (
                      <MoveTooltip move={dex.move(m)}>
                        <TypeBadge type={dex.move(m)!.type} size="xs" />
                      </MoveTooltip>
                    )}
                    <button
                      type="button"
                      aria-pressed={side.crits[i]}
                      title="Critical hit"
                      onClick={() => {
                        const crits = [...side.crits] as typeof side.crits;
                        crits[i] = !crits[i];
                        patchSide(role, { crits });
                      }}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md border',
                        side.crits[i] ? 'border-warn bg-warn/15 text-warn' : 'border-border text-muted hover:text-fg',
                      )}
                    >
                      <Crosshair size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <SideControls
              cond={side.cond}
              onChange={(p) => patchCond(role, p)}
              ability={forme !== species ? Object.values(forme!.abilities)[0] : dex.ability(set.abilityId)?.name}
              canMega={!!mega && format.gimmicks.mega}
              canTera={format.gimmicks.tera && !!set.teraType}
              teraType={set.teraType}
            />

            {sys.kind === 'champions-sp' && (
              <details className="group rounded-lg border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted group-open:border-b group-open:border-border">
                  Stat Points · {Object.values(set.sp).reduce((a, b) => a + b, 0)}/{sys.totalCap}
                </summary>
                <div className="p-3">
                  <StatDistributor
                    set={set}
                    species={species}
                    mega={mega}
                    format={format}
                    dex={dex}
                    onSpread={(stat, v) => patchSet(role, { sp: setSpreadValue(set.sp, stat, v, sys.totalCap, sys.perStatCap) })}
                    onReplaceSpread={(sp) => patchSet(role, { sp })}
                    onNature={(nature) => patchSet(role, { nature })}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
