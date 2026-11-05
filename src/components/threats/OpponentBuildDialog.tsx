import { RotateCcw } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { usageLabel } from '@/domain/meta';
import type { ReportThreat } from '@/domain/reportThreats';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { TargetEditor } from '../reverse/TargetEditor';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, TypeBadge } from '../ui/primitives';

/**
 * Edit one opponent's build (item, ability, nature, stat points, four moves) for the OHKO report. The
 * build belongs to the species and stays until reset; the report recalculates behind the dialog.
 */
export function OpponentBuildDialog({ dex, format, threat, onChange, onReset, onClose }: { dex: Dex; format: FormatRules; threat: ReportThreat; onChange: (patch: Partial<PokemonSet>) => void; onReset: () => void; onClose: () => void }) {
  const sp = dex.species(threat.speciesId);
  const name = sp?.name ?? threat.speciesId;
  const stone = threat.withStone ? dex.item(threat.withStone)?.name : undefined;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${name}'s build`} description="Used for it in this report instead of its most-used set, until you reset it." wide>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sprite speciesId={threat.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{name}</div>
            <div className="flex flex-wrap gap-1">{sp?.types.map((t) => <TypeBadge key={t} type={t} size="xs" />)}</div>
          </div>
          {threat.custom ? <Chip tone="accent">Custom build</Chip> : <Chip>{usageLabel(threat) ? `Most-used set · ${usageLabel(threat)}` : stone ? `With ${stone}` : 'Generic build'}</Chip>}
        </div>
        <div className="border-t border-border">
          <TargetEditor dex={dex} format={format} set={threat.set} onChange={onChange} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {threat.custom && (
            <Button variant="ghost" onClick={onReset} aria-label={`Reset ${name} to default`}>
              <RotateCcw size={14} aria-hidden /> Reset to default
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
