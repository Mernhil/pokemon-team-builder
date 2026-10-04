import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight, Calculator, Check, Copy, Crosshair, Info, Timer } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { gameInfo } from '@/domain/games';
import { GEN_GAMES } from '@/domain/generations';
import { calcMoves, calcSpeed, type FormResult, type MoveResult, type SpeedResult } from '@/domain/battle/damage';
import type { FormatRules, Team } from '@/domain/types';
import { useCalcStore, type CalcSide, type SideKey } from '@/store/calcStore';
import { FieldControls } from '../battle/Controls';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Button, EmptyState, Notice, Panel, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { CalcSideEditor } from './CalcSideEditor';
import { MoveCoverage } from './MoveCoverage';

/**
 * Damage calculator: same dual-pane building blocks as the team builder (attacker | defender),
 * with results for both directions and turn order on top. Engine: @smogon/calc (Champions mechanics,
 * or the format's generation).
 */
export function DamageCalcView(props: { dex: Dex; format: FormatRules; team: Team }) {
  const game = gameInfo(props.format.game);
  if (game && !game.battleSim)
    return (
      <EmptyState icon={Calculator} title={`The damage calculator can’t model ${game.name}`}>
        Its battles aren&apos;t turn-based Pokémon Showdown mechanics
        {game.id === 'pla' ? ' (Agile and Strong Styles, action order)' : ' (real-time battles)'}. Switch the team to another format to use it.
      </EmptyState>
    );
  return <DamageCalcBody {...props} />;
}

function DamageCalcBody({ dex, format, team }: { dex: Dex; format: FormatRules; team: Team }) {
  const game = gameInfo(format.game);
  const attacker = useCalcStore((s) => s.attacker);
  const defender = useCalcStore((s) => s.defender);
  const field = useCalcStore((s) => s.field);
  const { setField, swap, patchSide } = useCalcStore.getState();

  const ready = !!attacker.set && !!defender.set && !!dex.species(attacker.set.speciesId) && !!dex.species(defender.set.speciesId);

  const results = useMemo(() => {
    if (!ready) return null;
    const a = { set: attacker.set!, cond: attacker.cond };
    const d = { set: defender.set!, cond: defender.cond };
    try {
      return {
        forward: calcMoves(dex, a, d, field, attacker.crits),
        backward: calcMoves(dex, d, a, field, defender.crits),
        speedA: calcSpeed(dex, a, field),
        speedD: calcSpeed(dex, d, field),
        error: null as string | null,
      };
    } catch (e) {
      return { forward: [], backward: [], speedA: [], speedD: [], error: (e as Error).message };
    }
  }, [ready, attacker, defender, field, dex]);

  const toggleCrit = (role: SideKey, i: number) => {
    const crits = [...useCalcStore.getState()[role].crits] as CalcSide['crits'];
    crits[i] = !crits[i];
    patchSide(role, { crits });
  };

  // Wide screens: Attacker | Field + Results | Defender side by side, the middle column sticky so the
  // numbers stay in view while editing either side. Narrower: results on top, sides below.
  return (
    <div className="space-y-4">
      {(format.capabilities.zMoves || format.capabilities.dynamax) && (
        <Notice icon={Info}>
          {format.capabilities.zMoves
            ? 'Z-Moves aren’t modelled: a Z-Crystal does nothing here and damage is shown for the regular move.'
            : 'Dynamax and Max Moves aren’t modelled: damage is shown for the regular move at normal HP.'}
        </Notice>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="scrollbar-thin space-y-4 lg:col-span-2 xl:sticky xl:top-[72px] xl:order-2 xl:col-span-1 xl:max-h-[calc(100dvh-88px)] xl:overflow-y-auto">
          <Panel
            title="Field"
            actions={
              <Button size="sm" onClick={swap} disabled={!attacker.set && !defender.set}>
                <ArrowLeftRight size={13} /> Swap sides
              </Button>
            }
          >
            <FieldControls field={field} onChange={setField} gen={dex.generation} game={format.game} />
          </Panel>

          <Panel title="Results">
            {!results ? (
              <EmptyState icon={Crosshair} title="Pick an attacker and a defender">
                Load them from your team with one tap, or search any Pokémon {format.statSystem.kind === 'champions-sp' ? 'legal in' : 'from'} {format.shortName}.
              </EmptyState>
            ) : results.error ? (
              <Notice tone="bad" icon={AlertCircle} title="The calculator couldn’t handle this matchup">
                {results.error}
              </Notice>
            ) : (
              <div className="@container space-y-4">
                <TurnOrder attacker={attacker} defender={defender} speedA={results.speedA} speedD={results.speedD} trickRoom={field.trickRoom} dex={dex} format={format} />
                <div className="grid gap-4 @2xl:grid-cols-2">
                  <ResultList title="Attacker → Defender" tone="bad" results={results.forward} dex={dex} onToggleCrit={(i) => toggleCrit('attacker', i)} />
                  <ResultList title="Defender → Attacker" tone="accent" results={results.backward} dex={dex} onToggleCrit={(i) => toggleCrit('defender', i)} />
                </div>
              </div>
            )}
          </Panel>

          <MoveCoverage dex={dex} attacker={attacker.set ?? undefined} defender={defender.set ?? undefined} />
        </div>

        <div className="xl:order-1">
          <CalcSideEditor role="attacker" dex={dex} format={format} team={team} />
        </div>
        <div className="xl:order-3">
          <CalcSideEditor role="defender" dex={dex} format={format} team={team} />
        </div>
      </div>
      <p className="text-center text-xs text-muted">
        Damage engine: @smogon/calc (Pokémon Showdown),{' '}
        {game
          ? `${game.name}: Gen ${game.generation} mechanics with the game's own stats (AVs, friendship)`
          : dex.data.generation
          ? `Gen ${dex.data.generation} mechanics (${GEN_GAMES[dex.data.generation]}) · ${dex.data.generation <= 2 ? 'DVs / Stat Exp' : 'IVs / EVs'}`
          : 'Pokémon Champions mechanics · Lv 50 · 31 IVs · Stat Points'}
      </p>
    </div>
  );
}

/** One side's speed(s): one number, or "Base 100 · Mega 130" when its Mega mode is "Both". */
function SpeedBadge({ speeds, speciesId, name, types, format }: { speeds: SpeedResult[]; speciesId: string; name: string; types: string[]; format: FormatRules }) {
  return (
    <span className="flex items-center gap-1.5">
      <Sprite speciesId={speciesId} name={name} types={types as never} set={format.spriteSet} size={24} />
      {speeds.map((s, i) => (
        <span key={s.form} className="font-mono tabular-nums">
          {i > 0 && <span className="text-muted"> · </span>}
          {speeds.length > 1 && <span className="text-muted">{s.form === 'mega' ? 'Mega ' : 'Base '}</span>}
          <b>{s.speed}</b>
        </span>
      ))}
      <span className="text-muted">Spe</span>
    </span>
  );
}

function TurnOrder({
  attacker,
  defender,
  speedA,
  speedD,
  trickRoom,
  dex,
  format,
}: {
  attacker: CalcSide;
  defender: CalcSide;
  speedA: SpeedResult[];
  speedD: SpeedResult[];
  trickRoom: boolean;
  dex: Dex;
  format: FormatRules;
}) {
  const a = dex.species(attacker.set!.speciesId)!;
  const d = dex.species(defender.set!.speciesId)!;
  // One combo each (the common case): a single "who moves first" sentence. Either side on "Both":
  // one line per attacker-speed × defender-speed combo, since the two formes can tie differently.
  const combos = speedA.flatMap((sa) => speedD.map((sd) => ({ sa, sd })));
  const firstMover = (sa: number, sd: number) => (sa === sd ? null : (sa > sd) !== trickRoom ? 'attacker' : 'defender');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
      <Timer size={14} className="text-muted" />
      <SpeedBadge speeds={speedA} speciesId={a.id} name={a.name} types={a.types} format={format} />
      <span className="text-muted">vs</span>
      <SpeedBadge speeds={speedD} speciesId={d.id} name={d.name} types={d.types} format={format} />
      <span className="ml-auto text-right font-medium">
        {combos.map(({ sa, sd }, i) => {
          const first = firstMover(sa.speed, sd.speed);
          const label = combos.length > 1 ? `${sa.form === 'mega' ? 'Mega' : 'Base'}→${sd.form === 'mega' ? 'Mega' : 'Base'}: ` : '';
          return (
            <span key={i} className="block">
              {label}
              {first === null ? 'Speed tie: 50/50' : `${first === 'attacker' ? a.name : d.name} moves first`}
            </span>
          );
        })}
        {trickRoom && <span className="text-accent"> (Trick Room)</span>}
        <span className="text-muted"> · same priority bracket</span>
      </span>
    </div>
  );
}

function ResultList({
  title,
  tone,
  results,
  dex,
  onToggleCrit,
}: {
  title: string;
  tone: 'bad' | 'accent';
  results: MoveResult[];
  dex: Dex;
  onToggleCrit: (moveIndex: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span className={cn('h-2 w-2 rounded-full', tone === 'bad' ? 'bg-bad' : 'bg-accent')} />
        {title}
      </div>
      {results.length === 0 ? (
        <p className="text-xs text-muted">No moves selected.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <ResultRow key={r.index} r={r} dex={dex} onToggleCrit={() => onToggleCrit(r.index)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ r, dex, onToggleCrit }: { r: MoveResult; dex: Dex; onToggleCrit: () => void }) {
  const status = r.category === 'Status';
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <MoveTooltip move={dex.move(r.moveId)}>
          <TypeBadge type={r.type as never} size="xs" />
        </MoveTooltip>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
        {!status && (
          <button
            type="button"
            aria-pressed={r.crit}
            aria-label={`Critical hit: ${r.name}`}
            title={r.crit ? 'Critical hit on: click for a normal hit' : 'Calculate as a critical hit'}
            onClick={onToggleCrit}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-bold transition-colors',
              r.crit ? 'border-warn bg-warn/15 text-warn' : 'border-border text-muted hover:border-muted/60 hover:text-fg',
            )}
          >
            <Crosshair size={11} /> CRIT
          </button>
        )}
      </div>
      {status ? (
        <p className="mt-1 text-xs text-muted">Status move: no damage</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {r.forms.map((f, i) => <FormRow key={i} f={f} />)}
        </div>
      )}
    </li>
  );
}

function FormRow({ f }: { f: FormResult }) {
  const [copied, setCopied] = useState(false);
  const [lo, hi] = f.percent;
  const cur = (f.defenderCurHP / f.defenderHP) * 100;
  const koColor = hi >= cur ? (lo >= cur ? 'text-bad' : 'text-warn') : 'text-fg';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(f.desc);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* blocked */
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        {f.label && <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] font-semibold text-muted">{f.label}</span>}
        <span className={cn('ml-auto font-mono text-sm font-bold tabular-nums', koColor)}>
          {lo}–{hi}%
        </span>
      </div>
      {/* Damage bar: remaining HP with the min–max band */}
      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-good/35" style={{ width: `${Math.min(100, cur)}%` }} />
        <div
          className="absolute inset-y-0 bg-bad/70"
          style={{ left: `${Math.max(0, cur - Math.min(cur, hi))}%`, width: `${Math.min(cur, hi) - Math.min(cur, lo)}%` }}
        />
        <div className="absolute inset-y-0 bg-bad" style={{ left: `${Math.max(0, cur - Math.min(cur, lo))}%`, width: `${Math.min(cur, lo)}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          {f.range[0]}–{f.range[1]} HP of {f.defenderHP}
          {f.koText && <b className="ml-1.5 text-fg">· {f.koText}</b>}
        </span>
        <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 text-muted hover:text-fg" title="Copy calc text">
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      <details className="mt-0.5">
        <summary className="cursor-pointer text-[10px] text-muted">Details & rolls</summary>
        <p className="mt-1 text-xs leading-relaxed">{f.desc}</p>
        <p className="mt-1 font-mono text-[10px] text-muted">{f.rolls.join(', ')}</p>
      </details>
    </div>
  );
}
