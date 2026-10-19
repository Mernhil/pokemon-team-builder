import { useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, List, Pencil, RotateCcw, Skull } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { usageLabel } from '@/domain/meta';
import { topThreats, type ReportThreat } from '@/domain/reportThreats';
import { THREAT_COUNTS, moveChoices, ohkoEntries, type Kill, type OhkoMode, type ThreatCell } from '@/domain/threats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useOhkoBuilds } from '@/store/ohkoBuildStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { ChipRow, Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Help, LoadingState, Notice, Panel, Select, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';
import { FormSwitch } from '../ui/FormSwitch';
import { OpponentBuildDialog } from './OpponentBuildDialog';
import { useThreatReport } from './useThreatReport';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions');
const range = (p: [number, number]) => (p[0] === p[1] ? `${p[0]}%` : `${p[0]}–${p[1]}%`);
/** How many rows a card shows before "Show more" (the full list has a few hundred). */
const PAGE = 40;
const KILL_WORD: Record<Kill, string> = { ohko: 'OHKO', pohko: 'Possible', '2hko': '2HKO', '3hko': '3HKO+', none: 'No damage' };

/**
 * Two reports in one view, on the Threat report's engine and data: which of the most-used Pokémon can
 * OHKO each of yours ('by'), and which of them each of yours can OHKO ('to'). Guaranteed OHKOs come
 * first, then ones that only happen on some damage rolls; tap a row to open it in the Damage Calc.
 *
 * Every move counts, not just the best one: a card's Move row narrows the list to one move. A card's
 * Details button lists every Pokémon the regulation allows (and the Mega variants), at every kill class.
 * Each opponent's build can be edited (pencil on its row) and is kept until reset.
 */
export function OhkoReportView({ dex, format, team, mode, onMode }: { dex: Dex; format: FormatRules; team: Team; mode: OhkoMode; onMode: (m: OhkoMode) => void }) {
  const setView = useTeamStore((s) => s.setView);
  const [count, setCount] = useState<number>(30);
  const [possible, setPossible] = useState(true);
  const [field, setField] = useState<FieldConditions>({ gameType: 'Doubles', weather: '', terrain: '', trickRoom: false, gravity: false });
  const [baseForms, setBaseForms] = useState<ReadonlySet<string>>(new Set());
  const setForm = (id: string, base: boolean) => setBaseForms((s) => { const n = new Set(s); if (base) n.add(id); else n.delete(id); return n; });
  // The slots whose full list is open: any one of them has the report calculate every Pokémon.
  const [detailSlots, setDetailSlots] = useState<ReadonlySet<number>>(new Set());
  const wide = detailSlots.size > 0;
  const setDetails = (slot: number, on: boolean) => setDetailSlots((s) => { const n = new Set(s); if (on) n.add(slot); else n.delete(slot); return n; });
  const builds = useOhkoBuilds((s) => s.builds);
  const [editKey, setEditKey] = useState<string | null>(null);
  const { picked, loading, threats, members, rows, done, error } = useThreatReport({ dex, format, team, count, field, baseForms, all: wide, builds });
  const by = mode === 'by';
  const Icon = by ? Skull : Crosshair;
  const title = by ? 'Can be OHKO’d by' : 'Can OHKO';

  // The compact lists only ever read the most-used sets, even while the full job is running.
  const topIds = useMemo(() => (picked ? new Set(topThreats(dex, format, picked.snapshot, count).map((t) => t.speciesId)) : new Set<string>()), [dex, format, picked, count]);
  const isTop = (t: ReportThreat | undefined) => !!t && (!wide || (!t.withStone && topIds.has(t.speciesId)));
  const topRows = useMemo(() => (wide ? rows.map((r, i) => (isTop(threats[i]) ? r : undefined)) : rows), [wide, rows, threats, topIds]); // oxlint-disable-line react-hooks/exhaustive-deps -- isTop only reads wide, topIds
  const editing = editKey ? threats.find((t) => t.key === editKey) : undefined;
  const customCount = Object.keys(builds).length;

  const open = (member: PokemonSet, slot: number, threat: ReportThreat) => {
    const calc = useCalcStore.getState();
    const mine = { set: member, cond: defaultSide(!!dex.megaFor(member.speciesId, member.itemId)), crits: [false, false, false, false] as [boolean, boolean, boolean, boolean], origin: { teamName: team.name, slot: slot + 1 } };
    const theirs = { set: threat.set, cond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode }, crits: [false, false, false, false] as [boolean, boolean, boolean, boolean] };
    // The attacker is whoever does the OHKO.
    calc.setSide('attacker', by ? theirs : mine);
    calc.setSide('defender', by ? mine : theirs);
    calc.setField(field);
    setView('calc');
  };

  const changeBuild = (t: ReportThreat, patch: Partial<PokemonSet>) => useOhkoBuilds.getState().setBuild(t.speciesId, { ...t.set, ...patch });
  const resetBuild = (speciesId: string) => {
    const was = useOhkoBuilds.getState().builds[speciesId];
    useOhkoBuilds.getState().resetBuild(speciesId);
    setEditKey(null);
    if (was) toast(`${dex.species(speciesId)?.name ?? speciesId} is back to its most-used set.`, { label: 'Undo', run: () => useOhkoBuilds.getState().restore({ [speciesId]: was }) });
  };
  const resetAll = () => {
    const was = useOhkoBuilds.getState().builds;
    useOhkoBuilds.getState().resetAll();
    setEditKey(null);
    toast('All custom builds reset.', { label: 'Undo', run: () => useOhkoBuilds.getState().restore(was) });
  };

  if (format.datasetId !== 'champions') {
    return (
      <EmptyState icon={Icon} title="This report needs meta usage data, which only exists for Champions">
        Switch the team’s format to a Champions regulation to see which Pokémon people actually use can OHKO yours, and which of theirs yours can OHKO.
      </EmptyState>
    );
  }
  if (loading) return <LoadingState label="Loading usage data…" />;
  if (!picked) {
    return (
      <EmptyState icon={Icon} title="No usage data to build this report from yet">
        Early numbers from tournaments and Showdown replays appear within days of a regulation starting; the app picks them up with its next update.
      </EmptyState>
    );
  }
  const reg = champRegs.find((r) => r.id === picked.regulationId);
  const set = <K extends keyof FieldConditions>(k: K, v: FieldConditions[K]) => setField((f) => ({ ...f, [k]: v }));
  const calculated = rows.filter(Boolean).length;
  const stoneHolders = threats.filter((t) => isTop(t) && dex.megaFor(t.speciesId, t.set.itemId));

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Tabs<'ohkod' | 'ohko'>
            label="OHKO report"
            tabs={[
              { id: 'ohkod', label: 'Can be OHKO’d by', icon: Skull },
              { id: 'ohko', label: 'Can OHKO', icon: Crosshair },
            ]}
            value={by ? 'ohkod' : 'ohko'}
            onChange={(v) => onMode(v === 'ohkod' ? 'by' : 'to')}
          />
          <p className="min-w-0 text-sm text-muted">
            against the {count} most-used sets in <b className="text-fg">{reg?.name ?? picked.regulationId}</b>
          </p>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Top
            <Select aria-label="Pokémon checked" className="w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {THREAT_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} Pokémon
                </option>
              ))}
            </Select>
          </label>
        </div>
        <ChipRow label="Battle">
          <Toggle pressed={field.gameType === 'Doubles'} onClick={() => set('gameType', 'Doubles')}>
            Doubles
          </Toggle>
          <Toggle pressed={field.gameType === 'Singles'} onClick={() => set('gameType', 'Singles')}>
            Singles
          </Toggle>
          <Toggle pressed={field.trickRoom} onClick={() => set('trickRoom', !field.trickRoom)}>
            Trick Room
          </Toggle>
        </ChipRow>
        <ChipRow label="Include">
          <Toggle pressed={possible} onClick={() => setPossible(!possible)} title="OHKOs that only happen on some damage rolls">
            Possible OHKOs
          </Toggle>
        </ChipRow>
        {customCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              {customCount} custom {customCount === 1 ? 'build' : 'builds'} in use.
            </span>
            <Button variant="ghost" onClick={resetAll}>
              <RotateCcw size={14} aria-hidden /> Reset all
            </Button>
          </div>
        )}
      </Panel>

      {picked.fellBackFrom && (
        <Notice icon={AlertTriangle} title={`No usage data for ${champRegs.find((r) => r.id === picked.fellBackFrom)?.shortName ?? 'this regulation'} yet`}>
          Showing {reg?.shortName ?? picked.regulationId}’s numbers, the newest published.
        </Notice>
      )}
      {error && <Notice tone="bad" title="Couldn’t calculate the report">{error}</Notice>}

      {members.length === 0 ? (
        <EmptyState icon={Icon} title="Add Pokémon to your team first">
          Each of your Pokémon is calculated against each common set.
        </EmptyState>
      ) : (
        <>
          <p role="status" className="text-xs text-muted">
            {done ? `${calculated} Pokémon calculated against ${members.length} of yours.` : `Calculating… ${calculated} of ${threats.length}`}
          </p>
          {stoneHolders.length > 0 && (
            <details className="rounded-lg border border-border bg-surface-2/40 p-2 text-sm">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-fg">
                Mega Stone holders are calculated as their Mega{baseForms.size ? ` (${baseForms.size} switched to Base)` : ''}. Change forms
              </summary>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {stoneHolders.map((t) => (
                  <li key={t.speciesId} className="flex items-center gap-2">
                    <Sprite speciesId={t.speciesId} name={dex.species(t.speciesId)?.name} types={dex.species(t.speciesId)?.types} set={format.spriteSet} size={24} />
                    <b>{dex.species(t.speciesId)?.name ?? t.speciesId}</b>
                    <FormSwitch dex={dex} speciesId={t.speciesId} itemId={t.set.itemId} base={baseForms.has(t.speciesId)} onChange={(b) => setForm(t.speciesId, b)} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2" aria-label={title}>
            {members.map((m, j) => (
              <MemberCard
                key={`${mode}:${m.slot}`}
                dex={dex}
                format={format}
                mode={mode}
                member={m.set}
                memberIndex={j}
                slot={m.slot}
                rows={rows}
                topRows={topRows}
                threats={threats}
                count={count}
                done={done}
                possible={possible}
                detailsOpen={detailSlots.has(m.slot)}
                onDetails={(on) => setDetails(m.slot, on)}
                onOpen={(t) => open(m.set, m.slot, t)}
                onEdit={(t) => setEditKey(t.key)}
              />
            ))}
          </ul>
          <Help label="How to read this list">
            “OHKO” means every damage roll knocks out from full HP; “Possible” only some rolls. {by ? 'The Pokémon is read as its Mega when it holds the stone (switch it to Base above) and your Mega Stone holders at their worse forme.' : 'Your Mega Stone holders are read at their worse forme; theirs are read as their Mega when they hold the stone (switch to Base above).'} Every move of both sides is calculated; the row
            shows the strongest, and the Move chips narrow a card to one move. Details lists every Pokémon the regulation allows, each with its most-used set (or a generic attacker build when it has no usage data) plus the Mega
            Stone holders, with every kill class. Tap the pencil on a row to give a Pokémon your own build. Calculated with the Damage Calc under the conditions above. Tap a row to open it there.
          </Help>
        </>
      )}
      {editing && (
        <OpponentBuildDialog dex={dex} format={format} threat={editing} onChange={(patch) => changeBuild(editing, patch)} onReset={() => resetBuild(editing.speciesId)} onClose={() => setEditKey(null)} />
      )}
    </div>
  );
}

interface MemberCardProps {
  dex: Dex;
  format: FormatRules;
  mode: OhkoMode;
  member: PokemonSet;
  memberIndex: number;
  slot: number;
  /** Every row calculated so far (the full list when Details is open somewhere). */
  rows: (ThreatCell[] | undefined)[];
  /** Only the most-used sets' rows. */
  topRows: (ThreatCell[] | undefined)[];
  threats: ReportThreat[];
  count: number;
  done: boolean;
  possible: boolean;
  detailsOpen: boolean;
  onDetails: (open: boolean) => void;
  onOpen: (threat: ReportThreat) => void;
  onEdit: (threat: ReportThreat) => void;
}

/** One of your Pokémon: the headline count, a Move filter, the list (compact, or every Pokémon under Details). */
function MemberCard({ dex, format, mode, member, memberIndex: j, rows, topRows, threats, count, done, possible, detailsOpen, onDetails, onOpen, onEdit }: MemberCardProps) {
  const by = mode === 'by';
  const [moveId, setMoveId] = useState('');
  const [shown, setShown] = useState(PAGE);
  const sp = dex.species(member.speciesId);
  const src = detailsOpen ? rows : topRows;
  const opts = { all: detailsOpen, possible };
  const choices = useMemo(() => moveChoices(src, j, mode, opts), [src, j, mode, detailsOpen, possible]); // oxlint-disable-line react-hooks/exhaustive-deps -- opts is built from these
  const list = useMemo(() => ohkoEntries(src, j, mode, { ...opts, move: moveId || undefined }), [src, j, mode, detailsOpen, possible, moveId]); // oxlint-disable-line react-hooks/exhaustive-deps -- opts is built from these
  // The headline always counts OHKOs of the most-used sets (under the move filter), however the list below is showing.
  const headline = useMemo(() => ohkoEntries(topRows, j, mode, { possible, move: moveId || undefined }), [topRows, j, mode, possible, moveId]);
  const sure = headline.filter((e) => e.kill === 'ohko').length;
  const chosen = choices.find((c) => c.moveId === moveId)?.move ?? dex.move(moveId)?.name;
  const names = dex.species(member.speciesId)?.name ?? 'It';

  return (
    <li className="min-w-0">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Sprite speciesId={member.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
            {sp?.name ?? member.speciesId}
          </span>
        }
        actions={
          <Chip tone={by ? (sure ? 'bad' : headline.length ? 'warn' : 'good') : sure ? 'good' : 'neutral'}>
            {headline.length === 0 ? (done ? 'None' : '…') : `${sure} sure${headline.length > sure ? ` · ${headline.length - sure} possible` : ''}`}
          </Chip>
        }
      >
        <div className="min-w-0 space-y-2">
          {(choices.length > 1 || moveId) && (
            <ChipRow label="Move">
              <Toggle pressed={!moveId} onClick={() => { setMoveId(''); setShown(PAGE); }}>
                All moves
              </Toggle>
              {choices.map((c) => (
                <Toggle key={c.moveId} pressed={moveId === c.moveId} onClick={() => { setMoveId(moveId === c.moveId ? '' : c.moveId); setShown(PAGE); }} title={`${c.count} with ${c.move}`}>
                  {c.move} · {c.count}
                </Toggle>
              ))}
            </ChipRow>
          )}
          {list.length === 0 ? (
            <p className="text-sm text-muted">
              {!done
                ? 'Calculating…'
                : by
                  ? `${chosen ? `None of the checked Pokémon OHKO ${names} with ${chosen}.` : `None of the top ${count} OHKOs ${names}.`}`
                  : `${names} can’t OHKO any of ${chosen ? `the checked Pokémon with ${chosen}` : `the top ${count}`}.`}
            </p>
          ) : (
            <ul className="space-y-1">
              {list.slice(0, shown).map((e) => {
                const t = threats[e.threatIndex];
                if (!t) return null;
                return <ThreatRow key={t.key} dex={dex} format={format} by={by} member={member} threat={t} entry={e} onOpen={() => onOpen(t)} onEdit={() => onEdit(t)} />;
              })}
            </ul>
          )}
          {list.length > shown && (
            <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more ({list.length - shown} left)
            </Button>
          )}
          <Button variant={detailsOpen ? 'primary' : 'default'} aria-pressed={detailsOpen} onClick={() => { onDetails(!detailsOpen); setShown(PAGE); }}>
            <List size={14} aria-hidden /> {detailsOpen ? `Back to the top ${count}` : 'Details: every Pokémon'}
          </Button>
        </div>
      </Panel>
    </li>
  );
}

/** One opponent on a card: tap it for the Damage Calc, the pencil beside it for its build. */
function ThreatRow({ dex, format, by, member, threat: t, entry: e, onOpen, onEdit }: { dex: Dex; format: FormatRules; by: boolean; member: PokemonSet; threat: ReportThreat; entry: ReturnType<typeof ohkoEntries>[number]; onOpen: () => void; onEdit: () => void }) {
  const tsp = dex.species(t.speciesId);
  const sp = dex.species(member.speciesId);
  const tname = tsp?.name ?? t.speciesId;
  const speed = e.first === 'me' ? 'you move first' : e.first === 'them' ? 'it moves first' : 'speed tie';
  const verb = e.kill === 'ohko' ? 'OHKOs' : e.kill === 'pohko' ? 'can OHKO' : `${KILL_WORD[e.kill]}s`;
  const stone = t.withStone ? dex.item(t.withStone)?.name : undefined;
  const sentence = `${by ? `${tname}${stone ? ` holding ${stone}` : ''} ${verb} ${sp?.name}` : `${sp?.name} ${verb} ${tname}${stone ? ` holding ${stone}` : ''}`} with ${e.move.move} (${range(e.move.percent)}); ${speed}.`;
  const origin = t.custom ? 'Custom build' : stone ? `with ${stone}` : usageLabel(t) || 'Generic build';
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${sentence} Open in the Damage Calc.`}
        title={sentence}
        className={cn(
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1 text-left text-sm hover:brightness-95',
          e.kill === 'ohko' ? (by ? 'border-warn/60 bg-warn/15' : 'border-accent/50 bg-accent/12') : 'border-border bg-surface-2',
        )}
      >
        <Sprite speciesId={t.speciesId} name={tsp?.name} types={tsp?.types} set={format.spriteSet} size={28} />
        <span className="min-w-0 flex-1">
          <b className="block truncate">{tname}{t.megaMode !== 'base' ? ' (Mega)' : ''}</b>
          <span className="block text-xs text-muted">
            {e.move.move} · {range(e.move.percent)} · {origin}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs">
          <b className="block">{KILL_WORD[e.kill]}</b>
          <span className="text-muted">{speed}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${tname}’s build`}
        title="Edit this Pokémon’s build"
        className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted hover:text-fg"
      >
        <Pencil size={14} aria-hidden />
      </button>
    </li>
  );
}
