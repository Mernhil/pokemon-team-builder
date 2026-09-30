import { useMemo, useState } from 'react';
import { Crosshair, Download, MapPin, Shield, Swords } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { importShowdown } from '@/domain/codecs';
import { defaultSide } from '@/domain/battle/conditions';
import { monToSet, trainerToShowdown, trainerToTeam, trainerVariants, type AtlasMon, type AtlasTrainer } from '@/domain/atlas';
import { validateTeam } from '@/domain/validation';
import { useCalcStore, type SideKey } from '@/store/calcStore';
import { toast } from '@/store/toastStore';
import { useTeamStore } from '@/store/teamStore';
import { DefenseMatrix } from '../analysis/DefenseMatrix';
import { OffenseMatrix } from '../analysis/OffenseMatrix';
import { AdvancedDetails } from '../editor/AdvancedDetails';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Disclosure, Tabs, TypeBadge } from '../ui/primitives';
import { useAtlasCtx } from './context';

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
export const KIND_LABEL: Record<AtlasTrainer['kind'], string> = {
  trainer: 'Trainer',
  leader: 'Gym Leader',
  'elite-four': 'Elite Four',
  champion: 'Champion',
  rival: 'Rival',
  boss: 'Team Galactic',
  other: 'Other',
};

/**
 * One trainer's full battle: a version selector (first battle / rematches / the rival's starter), every
 * Pokémon with the builder's own sprite, item icon, type badges and move tooltips, advanced stats,
 * the team's defensive and offensive matrices, and the Load into Builder / Damage Calc actions.
 */
export function TrainerDetail({ group, initial }: { group: string; initial?: string }) {
  const { file, dex, format, locName, openLocation } = useAtlasCtx();
  const variants = useMemo(() => trainerVariants(file, group), [file, group]);
  const [pickedId, setPickedId] = useState(initial ?? variants[0]?.id);
  const trainer = variants.find((v) => v.id === pickedId) ?? variants[0];
  const team = useMemo(() => (trainer ? trainerToTeam(trainer, dex, format) : undefined), [trainer, dex, format]);
  if (!trainer || !team) return <p className="text-sm text-muted">No data for this trainer.</p>;

  const toBuilder = () => loadIntoBuilder(trainer, dex, format, true);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent" icon={Swords}>{KIND_LABEL[trainer.kind]}</Chip>
        <span className="text-sm text-muted">{trainer.cls}</span>
        {trainer.double && <Chip>Double battle</Chip>}
        {trainer.loc && (
          <button type="button" onClick={() => openLocation(trainer.loc!)} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <MapPin size={13} aria-hidden /> {locName(trainer.loc)}
          </button>
        )}
      </div>

      {variants.length > 1 && (
        <Tabs
          label="Version"
          size="sm"
          value={trainer.id}
          onChange={setPickedId}
          tabs={variants.map((v) => ({ id: v.id, label: v.variant ?? 'First battle' }))}
          className="flex-wrap"
        />
      )}

      {trainer.quote?.pre && <blockquote className="border-l-2 border-border-strong pl-3 text-sm whitespace-pre-line text-muted italic">“{trainer.quote.pre}”</blockquote>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={toBuilder}>
          <Download size={15} aria-hidden /> Load into Builder
        </Button>
        <span className="self-center text-xs text-muted">Opens as a {format.shortName} team.</span>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2">
        {trainer.party.map((mon, i) => (
          <MonCard key={i} mon={mon} index={i} trainer={trainer} />
        ))}
      </ol>

      {trainer.bag && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Uses in battle:
          {trainer.bag.map((it, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5">
              <ItemSprite itemId={it} size={16} />
              {file.items[it]?.name ?? it}
            </span>
          ))}
        </div>
      )}

      <DefenseMatrix team={team} dex={dex} format={format} />
      <OffenseMatrix team={team} dex={dex} />
    </div>
  );
}

function MonCard({ mon, index, trainer }: { mon: AtlasMon; index: number; trainer: AtlasTrainer }) {
  const { dex, format, file, speciesName } = useAtlasCtx();
  const species = dex.species(mon.species);
  const set = useMemo(() => monToSet(mon, dex, format, `atlas:${trainer.id}:${index}`), [mon, dex, format, trainer.id, index]);
  const ability = dex.ability(set.abilityId);
  const item = mon.item ? file.items[mon.item] : undefined;

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <Sprite speciesId={mon.species} name={speciesName(mon.species)} types={species?.types} set={format.spriteSet} size={64} backdrop />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold">{species?.name ?? speciesName(mon.species)}</h3>
            <span className="font-mono text-xs text-muted">Lv {mon.level}</span>
            {mon.gender && mon.gender !== 'N' && <span className="text-xs text-muted">{mon.gender === 'M' ? '♂' : '♀'}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">{species?.types.map((t) => <TypeBadge key={t} type={t} size="xs" />)}</div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
            {ability && (<><dt className="text-muted">Ability</dt><dd>{ability.name}</dd></>)}
            {mon.nature && (<><dt className="text-muted">Nature</dt><dd>{cap(mon.nature)}</dd></>)}
            <dt className="text-muted">IVs</dt>
            <dd>{mon.iv} in every stat</dd>
            <dt className="text-muted">EVs</dt>
            <dd>none</dd>
            <dt className="text-muted">Item</dt>
            <dd className="inline-flex items-center gap-1">{item ? (<><ItemSprite itemId={mon.item} size={18} />{item.name}</>) : '—'}</dd>
          </dl>
        </div>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1">
        {set.moves.map((m, i) => {
          const mv = dex.move(m);
          return (
            <li key={i} className="flex min-h-7 items-center gap-1.5 rounded-md bg-surface-2 px-1.5 text-xs">
              {mv ? (
                <MoveTooltip move={mv}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TypeBadge type={mv.type} size="xs" />
                    <span className="truncate">{mv.name}</span>
                  </span>
                </MoveTooltip>
              ) : (
                <span className="text-muted">—</span>
              )}
            </li>
          );
        })}
      </ul>
      {mon.movesDerived && <p className="mt-1 text-[11px] text-muted">The game picks these moves: the last four it learns by level {mon.level}.</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => sendToCalc('defender', trainer, index, dex, format)}>
          <Shield size={13} aria-hidden /> Calc as defender
        </Button>
        <Button size="sm" onClick={() => sendToCalc('attacker', trainer, index, dex, format)}>
          <Crosshair size={13} aria-hidden /> Calc as attacker
        </Button>
      </div>
      {species && (
        <Disclosure title="Stats & advanced details" className="mt-2 border-0 bg-transparent p-0 [&>summary]:px-0 [&>div]:px-0">
          <AdvancedDetails set={set} species={species} dex={dex} format={format} />
        </Disclosure>
      )}
    </li>
  );
}

/** Put a trainer's team into the builder through the Showdown importer, as a new team in the game's format. */
export function loadIntoBuilder(trainer: AtlasTrainer, dex: Dex, format: Parameters<typeof importShowdown>[2], openBuilder: boolean) {
  const { team, warnings } = importShowdown(trainerToShowdown(trainer, dex, format), dex, format, `${trainer.name} (${trainer.cls})`);
  const named = { ...team, category: `${format.shortName} · Atlas` };
  const issues = validateTeam(named, format, dex).filter((i) => i.severity === 'error');
  const store = useTeamStore.getState();
  store.addTeams([named], true);
  if (openBuilder) store.setView('builder');
  toast(`Loaded ${trainer.name}'s team${warnings.length || issues.length ? ` — ${warnings.length + issues.length} note${warnings.length + issues.length > 1 ? 's' : ''} in the builder` : ''}.`);
  return { team: named, warnings, issues };
}

function sendToCalc(side: SideKey, trainer: AtlasTrainer, index: number, dex: Dex, format: Parameters<typeof importShowdown>[2]) {
  // The calculator follows the active team's format, so the trainer's team becomes the active team first.
  const { team } = loadIntoBuilder(trainer, dex, format, false);
  const set = team.slots[index];
  if (!set) return;
  useCalcStore.getState().setSide(side, { set, cond: defaultSide(), crits: [false, false, false, false], origin: { teamName: team.name, slot: index } });
  useTeamStore.getState().setView('calc');
}

