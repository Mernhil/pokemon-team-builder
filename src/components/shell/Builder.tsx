import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { GEN_GAMES } from '@/domain/generations';
import type { FormatRules, Team } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { DefenseMatrix } from '../teamcheck/DefenseMatrix';
import { OffenseMatrix } from '../teamcheck/OffenseMatrix';
import { TeamCheck } from '../teamcheck/TeamCheck';
import { RegulationBanner } from '../teamcheck/RegulationBanner';
import { SharedTeamBanner } from '../team/SharedTeamBanner';
import { SetEditor } from '../editor/SetEditor';
import { TeamSlots, TeamStrip } from '../team/TeamSlots';
import { scrollBehavior } from '../ui/motion';
import { Panel } from '../ui/primitives';

/**
 * Workbench layout: team on the left, the selected Pokémon in the middle, team check on the right
 * (below the editor on narrower screens). Phones get a sprite strip instead of the team list.
 */
export function Builder({ team, format, dex }: { team: Team; format: FormatRules; dex: Dex }) {
  const activeSlot = useTeamStore((s) => s.activeSlot);
  const setActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const issues = useMemo(() => validateTeam(team, format, dex), [team, format, dex]);
  const filled = team.slots.filter(Boolean).length;
  const firstEmpty = team.slots.findIndex((s) => s === null);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
      {team.shared && (
        <div className="lg:col-span-2 xl:col-span-3">
          <SharedTeamBanner team={team} />
        </div>
      )}
      <div className="lg:col-span-2 xl:col-span-3">
        <RegulationBanner team={team} format={format} />
      </div>

      {/* Phones: one tap to the next empty slot (its species search opens there). */}
      {firstEmpty >= 0 && team.slots[activeSlot] && (
        <button
          type="button"
          onClick={() => {
            setActiveSlot(firstEmpty);
            window.scrollTo({ top: 0, behavior: scrollBehavior() });
          }}
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-xl sm:hidden"
          aria-label={`Add a Pokémon (slot ${firstEmpty + 1})`}
        >
          <Plus size={26} aria-hidden />
        </button>
      )}

      <aside aria-label="Team" className="hidden lg:sticky lg:top-[72px] lg:block lg:self-start">
        <Panel
          title={
            <>
              Team <span className="font-normal text-muted">· {filled}/{format.teamSize}</span>
            </>
          }
          actions={format.bring ? <span className="text-xs text-muted">Bring {format.bring}, pick {format.pick} · {format.gameType}</span> : undefined}
          bodyClassName="p-2 pt-1"
        >
          <TeamSlots team={team} dex={dex} format={format} issues={issues} activeSlot={activeSlot} />
        </Panel>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="lg:hidden">
          <TeamStrip team={team} dex={dex} format={format} issues={issues} activeSlot={activeSlot} />
        </div>
        <SetEditor key={team.id + activeSlot} teamId={team.id} slot={activeSlot} set={team.slots[activeSlot]} dex={dex} format={format} issues={issues} />
      </div>

      <aside aria-label="Team check" className="min-w-0 space-y-4 lg:col-start-2 xl:sticky xl:top-[72px] xl:col-start-3 xl:row-start-2 xl:self-start">
        <TeamCheck team={team} dex={dex} format={format} issues={issues} />
      </aside>

      <div className="min-w-0 space-y-4 lg:col-start-2 xl:col-span-1 xl:col-start-2">
        <DefenseMatrix team={team} dex={dex} format={format} />
        <OffenseMatrix team={team} dex={dex} />
        <p className="pb-2 text-center text-xs text-muted">
          {format.game
            ? `Data: ${dex.data.source} · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
            : dex.data.generation
              ? `Data: Pokémon Showdown's Gen ${dex.data.generation} data (${GEN_GAMES[dex.data.generation]}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`
              : `Data: Pokémon Showdown + official regulation announcements (${dex.data.regulations.map((r) => r.shortName).join(', ')}) · sprites: PokeAPI · generated ${dex.data.generatedAt.slice(0, 10)}`}
        </p>
      </div>
    </div>
  );
}
