import { Check, Pencil, Plus, RotateCcw } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { candidateKey, candidateUsageLabel, describeCondition, type Condition, type Match } from '@/domain/reverseSearch';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Notice, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { TargetEditor } from './TargetEditor';

/** What the card says about the forms that work: the Mega Stone holders, tried as the Mega and the base form. */
function formNote(m: Match, stoneName: string | undefined): string | undefined {
  if (!m.form) return undefined;
  if (m.candidate.withStone) return `Works as the Mega, holding ${stoneName ?? 'its stone'}.`;
  return m.form === 'either' ? 'Works as the Mega and as the base form.' : m.form === 'mega' ? 'Works as the Mega only; the base form does not.' : 'Works as the base form only; the Mega does not.';
}

/**
 * One answer of the reverse search: why it fits, the build the numbers use, and "Edit build", which opens
 * the same compact editor the targets have. A card being edited spans the row and stays where it is while
 * its answer changes; if the new build no longer meets the conditions it says so until the editor closes.
 */
export function ResultCard({
  dex,
  format,
  match: m,
  conditions,
  knows,
  custom,
  editing,
  stale,
  build,
  onEdit,
  onChangeBuild,
  onReset,
  onAdd,
  onCalc,
}: {
  dex: Dex;
  format: FormatRules;
  match: Match;
  conditions: Condition[];
  knows: string[];
  /** The player's own build of this species is in use. */
  custom: boolean;
  editing: boolean;
  /** The build no longer meets the conditions (the card is only still here because its editor is open). */
  stale: boolean;
  /** The build the editor starts from. */
  build: PokemonSet;
  onEdit: (open: boolean) => void;
  onChangeBuild: (patch: Partial<PokemonSet>) => void;
  onReset: () => void;
  onAdd: () => void;
  onCalc: () => void;
}) {
  const c = m.candidate;
  const sp = dex.species(c.speciesId);
  const name = sp?.name ?? c.speciesId;
  const set = c.set;
  const stoneName = c.withStone ? dex.item(c.withStone)?.name : undefined;
  const note = stale ? undefined : formNote(m, stoneName);
  const key = candidateKey(c);

  return (
    <li data-testid={`rs-card-${key}`} className={cn('flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3', editing ? 'border-accent sm:col-span-2 lg:col-span-3' : 'border-border', stale && 'opacity-90')}>
      <div className="flex items-center gap-2">
        <Sprite speciesId={c.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{name}</div>
          <div className="flex flex-wrap gap-1">{sp?.types.map((t) => <TypeBadge key={t} type={t} size="xs" />)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {c.withStone && <Chip tone="accent">with {stoneName ?? c.withStone}</Chip>}
          {custom ? (
            <Chip tone="accent">Custom build</Chip>
          ) : (
            <Chip tone={c.build === 'meta' ? 'accent' : 'neutral'}>{c.build === 'meta' ? `Meta set · ${candidateUsageLabel(c)}` : 'Generic build'}</Chip>
          )}
        </div>
      </div>
      {stale && <Notice tone="warn">Doesn&apos;t meet the conditions with this build. It drops out of the list when you close the editor.</Notice>}
      {note && <p className="text-xs text-muted">{note}</p>}
      {!stale && (
        <ul className="space-y-0.5 text-xs">
          {knows.map((id) => {
            const mv = dex.move(id);
            const changes = c.moveChanges;
            const added = !!mv && !!changes?.added.includes(mv.name);
            return (
              <li key={`knows-${id}`} className="flex items-start gap-1.5">
                <Check size={13} className="mt-0.5 shrink-0 text-good" aria-hidden />
                <span>
                  <span className="font-medium">Knows {mv?.name ?? id}</span>
                  <span className="text-muted">
                    {' · '}
                    {added ? `added${changes && changes.dropped.length ? `, replacing ${changes.dropped.join(', ')}` : ''}` : 'in its usual set'}
                  </span>
                </span>
              </li>
            );
          })}
          {m.results.map((r) => {
            const cond = conditions.find((x) => x.id === r.conditionId);
            return (
              <li key={r.conditionId} className="flex items-start gap-1.5">
                <Check size={13} className="mt-0.5 shrink-0 text-good" aria-hidden />
                <span>
                  <span className="font-medium">{cond ? describeCondition(dex, cond) : ''}</span>
                  <span className="text-muted"> · {r.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="truncate text-xs text-muted" title="The build the numbers use">
        {dex.item(set.itemId)?.name ?? 'No item'} · {set.nature} · {set.moves.filter(Boolean).map((mv) => dex.move(mv)?.name ?? mv).join(', ')}
      </p>
      {editing && (
        <div className="border-t border-border">
          <TargetEditor dex={dex} format={format} set={build} onChange={onChangeBuild} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button onClick={onAdd} aria-label={`Add ${name} to team`} disabled={stale}>
          <Plus size={14} aria-hidden /> Add to team
        </Button>
        <Button variant="ghost" onClick={onCalc} disabled={stale}>
          Open in Calc
        </Button>
        <Button variant={editing ? 'primary' : 'default'} aria-expanded={editing} aria-label={editing ? `Done editing ${name}` : `Edit build of ${name}`} onClick={() => onEdit(!editing)}>
          <Pencil size={14} aria-hidden /> {editing ? 'Done' : 'Edit build'}
        </Button>
        {custom && (
          <Button variant="ghost" aria-label={`Reset ${name} to default`} onClick={onReset}>
            <RotateCcw size={14} aria-hidden /> Reset to default
          </Button>
        )}
      </div>
    </li>
  );
}
