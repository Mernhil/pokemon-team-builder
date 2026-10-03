import { useMemo, useState } from 'react';
import { AlertTriangle, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useRegulationChanges } from '@/data/regulationChanges';
import { useDex } from '@/data/useDex';
import { getFormat, regulationInfo } from '@/domain/formats';
import { relevantRegulations, teamImpact, type TeamImpact } from '@/domain/regulationImpact';
import { teamVariations } from '@/domain/team';
import type { SpriteSetId, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { ImpactList, impactSummary } from '../analysis/ImpactList';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { Button, Chip } from '../ui/primitives';
import { cn, typeGradient } from '../ui/styles';

/** Click (or the pencil icon) to edit; commits on blur/Enter, discards on Escape. */
function InlineEditable({
  value,
  placeholder,
  ariaLabel,
  onCommit,
  className,
  textClassName,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (v: string) => void;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = draft.trim();
          if (v && v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn('h-6 min-w-0 rounded border border-accent bg-surface px-1 text-sm font-semibold outline-none', className)}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`Rename ${value || placeholder}`}
      className={cn('group/name flex min-w-0 items-center gap-1 text-left', className)}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      <span className={cn('truncate', textClassName)}>{value || placeholder}</span>
      <Pencil size={11} className="shrink-0 text-muted opacity-0 group-hover/name:opacity-70" />
    </button>
  );
}


/**
 * A team as six tiles: each Pokémon's sprite on its type colours with its name underneath, so a
 * saved team reads at a glance (empty slots are dashed). 3 across on phones, 6 on wider screens;
 * `compact` is a single row of small tiles (variations).
 */
function TeamTiles({ team, dex, spriteSet, compact }: { team: Team; dex?: Dex; spriteSet: SpriteSetId; compact?: boolean }) {
  return (
    <ol className={cn('grid gap-1.5', compact ? 'grid-cols-6' : 'grid-cols-3 sm:grid-cols-6')}>
      {team.slots.map((s, i) => {
        if (!s) return <li key={i} className="aspect-square rounded-lg border border-dashed border-border" aria-label={`Slot ${i + 1}: empty`} />;
        const sp = dex?.species(s.speciesId);
        const name = s.nickname || sp?.name || s.speciesId;
        return (
          <li key={i} className="min-w-0">
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg" style={{ background: sp ? typeGradient(sp.types) : 'var(--color-surface-2)' }}>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/25" aria-hidden />
              <Sprite speciesId={s.speciesId} name={name} types={sp?.types} set={spriteSet} size={compact ? 30 : 56} className="drop-shadow-[0_2px_3px_rgb(0_0_0/0.45)]" />
            </div>
            {!compact && <p className="mt-0.5 truncate text-center text-xs font-medium">{name}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function DeleteButton({
  id,
  label,
  confirmId,
  setConfirmId,
  onDelete,
}: {
  id: string;
  label: string;
  confirmId: string | null;
  setConfirmId: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  if (confirmId === id) {
    return (
      <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            onDelete(id);
            setConfirmId(null);
          }}
        >
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
          Keep
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Delete ${label}`}
      className="shrink-0 hover:text-bad"
      onClick={(e) => {
        e.stopPropagation();
        setConfirmId(id);
      }}
    >
      <Trash2 size={14} />
    </Button>
  );
}


/** "Not live" when a team's regulation isn't the live one, and how many problems it would have in the live and the next one. */
function RegulationChips({ team, impacts, live }: { team: Team; impacts?: Map<string, TeamImpact>; live?: string }) {
  const f = getFormat(team.formatId);
  if (f.datasetId !== 'champions') return null;
  const notLive = !!live && f.regulationId !== live;
  return (
    <>
      {notLive && <Chip tone="warn">Not live: {f.shortName}</Chip>}
      {[...(impacts ?? [])].map(([reg, impact]) =>
        impact.counts.breaks > 0 ? (
          <Chip key={reg} tone="bad" icon={AlertTriangle}>
            {impact.counts.breaks} {impact.counts.breaks === 1 ? 'problem' : 'problems'} in {regulationInfo(reg)?.shortName ?? reg}
          </Chip>
        ) : null,
      )}
    </>
  );
}

export function TeamsDialog({ open, onOpenChange, dex }: { open: boolean; onOpenChange: (o: boolean) => void; dex?: Dex }) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const { selectTeam, duplicateTeam, deleteTeam, updateTeam, addVariation } = useTeamStore.getState();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  // Regulation impact: every Champions team (and variation) against the live regulation and the next
  // announced one that has data, minus what was already wrong in its own regulation.
  const champDex = useDex('champions');
  const changes = useRegulationChanges();
  const { live, next } = relevantRegulations();
  const targets = [live, next].filter((x): x is string => !!x);
  const impacts = useMemo(() => {
    const out = new Map<string, Map<string, TeamImpact>>();
    if (!open || champDex.status !== 'ready') return out;
    for (const t of Object.values(teams)) {
      if (getFormat(t.formatId).datasetId !== 'champions') continue;
      const own = getFormat(t.formatId).regulationId;
      const per = new Map<string, TeamImpact>();
      for (const reg of targets) if (reg !== own) per.set(reg, teamImpact(t, reg, champDex.dex, changes));
      out.set(t.id, per);
    }
    return out;
    // targets is derived from the clock; the manifest only changes with a new build
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teams, champDex, changes, live, next]);
  // The furthest-ahead regulation with a team that breaks in it, for the headline.
  const headline = [...targets].reverse().map((reg) => ({ reg, broken: [...impacts.entries()].filter(([, per]) => (per.get(reg)?.counts.breaks ?? 0) > 0) })).find((h) => h.broken.length > 0);

  const select = (id: string) => {
    selectTeam(id);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Saved teams" description="Stored on this device. Use Import / Export → JSON backup to move them to another one." wide>
      {headline && champDex.status === 'ready' && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn/8 p-3 text-sm" role="region" aria-label="Teams with problems in a newer regulation">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle size={16} className="shrink-0 text-warn" aria-hidden />
            <p className="min-w-0 flex-1 font-semibold">
              {headline.broken.length} of your {Object.keys(teams).length === 1 ? 'team has' : 'teams have'} problems in {regulationInfo(headline.reg)?.shortName ?? headline.reg}
            </p>
            <Button size="sm" aria-expanded={showProblems} onClick={() => setShowProblems((v) => !v)}>
              {showProblems ? 'Hide details' : 'Show details'}
            </Button>
          </div>
          {showProblems && (
            <ul className="mt-3 space-y-3">
              {headline.broken.map(([teamId, per]) => (
                <li key={teamId}>
                  <p className="mb-1 text-sm font-semibold">
                    {teams[teamId].name}
                    {teams[teamId].variationLabel ? ` · ${teams[teamId].variationLabel}` : ''}: {impactSummary(per.get(headline.reg)!.counts)}
                  </p>
                  <ImpactList impact={per.get(headline.reg)!} dex={champDex.dex} format={getFormat(teams[teamId].formatId)} />
                  <Button size="sm" className="mt-1.5" onClick={() => select(teamId)}>
                    Open this team
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ul className="space-y-3">
        {order.map((id) => {
          const t = teams[id];
          if (!t) return null;
          const f = getFormat(t.formatId);
          const variations = teamVariations(teams, id);
          const groupIsActive = id === activeTeamId;
          // "Add variation" duplicates whichever member of this group is currently selected.
          const currentInGroup = groupIsActive || teams[activeTeamId]?.groupId === id ? activeTeamId : id;

          return (
            <li key={id} className={cn('rounded-2xl border bg-surface p-3', groupIsActive ? 'border-accent ring-1 ring-accent' : 'border-border')}>
              <div className="flex items-start gap-1">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-1.5">
                  <InlineEditable value={t.name} ariaLabel="Saved team name" textClassName="text-base font-semibold" onCommit={(name) => updateTeam(id, { name })} />
                  <Chip>{t.category || f.shortName}</Chip>
                  {variations.length > 0 && <Chip>{variations.length + 1} variations</Chip>}
                  <RegulationChips team={t} impacts={impacts.get(t.id)} live={live} />
                  {groupIsActive && <Chip tone="accent">Editing</Chip>}
                </div>
                <Button size="icon" variant="ghost" aria-label={`Duplicate ${t.name}`} onClick={() => duplicateTeam(id)}>
                  <Copy size={15} aria-hidden />
                </Button>
                <DeleteButton id={id} label={t.name} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={deleteTeam} />
              </div>
              <button type="button" onClick={() => select(id)} className="mt-2 block w-full rounded-xl text-left" aria-label={`Open ${t.name}`}>
                <TeamTiles team={t} dex={dex} spriteSet={f.spriteSet} />
              </button>
              <p className="mt-2 text-xs text-muted">Edited {new Date(t.updatedAt).toLocaleString()}</p>

              {variations.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-l-2 border-border pl-3">
                  {variations.map((v) => (
                    <li key={v.id} className={cn('flex items-center gap-2 rounded-xl border p-2', v.id === activeTeamId ? 'border-accent bg-accent/5' : 'border-transparent bg-surface-2')}>
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <RegulationChips team={v} impacts={impacts.get(v.id)} live={live} />
                        <InlineEditable
                          value={v.variationLabel ?? 'Variation'}
                          ariaLabel="Variation label"
                          textClassName="text-sm font-semibold"
                          onCommit={(variationLabel) => updateTeam(v.id, { variationLabel })}
                        />
                        <button type="button" onClick={() => select(v.id)} className="w-full max-w-xs rounded-lg text-left" aria-label={`Open ${v.variationLabel ?? 'variation'}`}>
                          <TeamTiles team={v} dex={dex} spriteSet={f.spriteSet} compact />
                        </button>
                        <span className="text-xs text-muted">Edited {new Date(v.updatedAt).toLocaleString()}</span>
                      </div>
                      <DeleteButton id={v.id} label={v.variationLabel ?? 'variation'} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={deleteTeam} />
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => addVariation(currentInGroup)}>
                  <Plus size={14} aria-hidden /> Add variation
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
