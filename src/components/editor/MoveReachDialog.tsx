import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { defaultField } from '@/domain/battle/conditions';
import { usageLabel } from '@/domain/meta';
import { metaSets } from '@/domain/metaSets';
import { moveReach, type ReachRow } from '@/domain/moveReach';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { EmptyState, LoadingState, TypeBadge } from '../ui/primitives';
import { champRegIds } from './optimizerShared';

/** How many of the most used Pokémon are checked. */
const CHECKED = 60;
const pct = ([lo, hi]: [number, number]) => (lo === hi ? `${Math.round(lo)}%` : `${Math.round(lo)}–${Math.round(hi)}%`);

function Group({ dex, format, title, rows, empty }: { dex: Dex; format: FormatRules; title: string; rows: ReachRow[]; empty: string }) {
  return (
    <section aria-label={title} className="space-y-1">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {rows.map((r) => {
            const sp = dex.species(r.speciesId);
            return (
              <li key={r.speciesId} className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5" title={r.text}>
                <Sprite speciesId={r.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{sp?.name ?? r.speciesId}</span>
                  <span className="block truncate text-2xs text-muted">
                    {dex.item(r.itemId)?.name ?? 'no item'} · {usageLabel(r)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs">{pct(r.percent)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * "What does this move knock out?": the move on this Pokémon, with its own item, nature and stat points,
 * against the most-used set of each of the most used Pokémon: who it one-shots, who only on a high roll
 * and who it two-shots. Opened from the small button on a move in the builder.
 */
export function MoveReachDialog({ dex, format, set, moveId, onClose }: { dex: Dex; format: FormatRules; set: PokemonSet; moveId: string; onClose: () => void }) {
  const metaFor = useMetaFor();
  const picked = useMemo(() => (metaFor ? pickSpeedSnapshot(format.regulationId, champRegIds, metaFor) : undefined), [metaFor, format.regulationId]);
  const move = dex.move(moveId);
  const name = dex.species(set.speciesId)?.name ?? set.speciesId;
  const reach = useMemo(
    () => (picked ? moveReach(dex, format, set, moveId, metaSets(picked.snapshot, dex, format, CHECKED), defaultField()) : undefined),
    [picked, dex, format, set, moveId],
  );

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${move?.name ?? moveId} from ${name}`} description={`What it knocks out, with this build, among the ${CHECKED} most used Pokémon.`} wide>
      <div className="space-y-4 p-4">
        {move && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <TypeBadge type={move.type} size="xs" />
            {dex.item(set.itemId)?.name ?? 'No item'} · {set.nature} · calculated against their most-used sets, no field conditions.
          </p>
        )}
        {!metaFor ? (
          <LoadingState label="Loading meta data…" />
        ) : !reach ? (
          <EmptyState title="No usage data yet">There are no most-used sets to check this move against.</EmptyState>
        ) : (
          <>
            <Group dex={dex} format={format} title="One-shots" rows={reach.ohko} empty="Nothing, every roll included." />
            <Group dex={dex} format={format} title="One-shots on a high roll" rows={reach.possible} empty="Nothing more." />
            <Group dex={dex} format={format} title="Two-shots" rows={reach.twoHit} empty="Nothing more." />
          </>
        )}
      </div>
    </Modal>
  );
}
