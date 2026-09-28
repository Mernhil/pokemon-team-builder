import { useMemo, useRef, useState } from 'react';
import { Check, Copy, Upload } from 'lucide-react';
import type { Dex } from '@/data/dex';
import {
  decodeShareString,
  encodeShareString,
  exportBackup,
  exportChampionsText,
  exportTeamShowdown,
  importShowdown,
  normalizeReplicaCode,
  parseBackup,
} from '@/domain/codecs';
import { teamVariations } from '@/domain/team';
import type { FormatRules, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Button, Field, Input } from '../ui/primitives';
import { cn } from '../ui/styles';

type Tab = 'champions' | 'showdown' | 'share' | 'json' | 'import';

const TABS: { id: Tab; label: string }[] = [
  { id: 'champions', label: 'Team List' },
  { id: 'showdown', label: 'Showdown' },
  { id: 'share', label: 'Share code' },
  { id: 'json', label: 'JSON backup' },
  { id: 'import', label: 'Import' },
];

export function ImportExportDialog({
  open,
  onOpenChange,
  team,
  dex,
  format,
  initialTab = 'showdown',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team: Team;
  dex: Dex;
  format: FormatRules;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [copied, setCopied] = useState(false);
  const allTeams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const { updateTeam } = useTeamStore.getState();

  // The dialog stays mounted while closed; don't re-serialise the team on every edit.
  const text = useMemo(() => {
    if (!open) return '';
    switch (tab) {
      case 'champions':
        return exportChampionsText(team, dex, format);
      case 'showdown':
        return exportTeamShowdown(team, dex, format);
      case 'share':
        return encodeShareString(team);
      case 'json':
        // Export every team, not just top-level groups — otherwise variations would silently
        // vanish from the backup, since they're intentionally left out of `order`.
        return exportBackup(order.flatMap((id) => [allTeams[id], ...teamVariations(allTeams, id)]).filter((t): t is Team => !!t));
      default:
        return '';
    }
  }, [open, tab, team, dex, format, allTeams, order]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Import / Export" description={`${team.name} · ${format.name}`} wide>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-semibold', tab === t.id ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'import' ? (
        <ImportPane dex={dex} format={format} onDone={() => onOpenChange(false)} />
      ) : (
        <div className="space-y-3">
          {tab === 'champions' && (
            <Field label="Replica Team code" hint="issued in-game · stored with this team">
              <Input
                defaultValue={team.replicaCode ?? ''}
                placeholder="10 characters, e.g. AB12C D34EF"
                onBlur={(e) => {
                  const code = normalizeReplicaCode(e.target.value);
                  updateTeam(team.id, { replicaCode: code ?? undefined });
                  if (e.target.value && !code) e.target.value = '';
                }}
              />
            </Field>
          )}
          {tab === 'share' && (
            <p className="text-xs text-muted">
              A self-contained code for this builder — paste it into <b>Import</b> on any device. (Replica Team codes are
              minted by the game's servers, so they can be stored on a team but not generated here.)
            </p>
          )}
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.target.select()}
            className={cn(
              'scrollbar-thin h-72 w-full resize-none rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed outline-none',
              tab === 'share' && 'h-28 break-all',
            )}
          />
          <div className="flex justify-end gap-2">
            <Button variant="primary" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Backups, share codes and Showdown exports are a few KB; anything this big isn't one of them. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function ImportPane({ dex, format, onDone }: { dex: Dex; format: FormatRules; onDone: () => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const addTeams = useTeamStore((s) => s.addTeams);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (input: string) => {
    const src = input.trim();
    if (!src) return;
    try {
      if (src.startsWith('{')) {
        const teams = parseBackup(src);
        addTeams(teams);
        setMsg({ kind: 'ok', text: `Restored ${teams.length} team(s).` });
      } else if (src.startsWith('PTB1.')) {
        addTeams([decodeShareString(src, dex, format)]);
        setMsg({ kind: 'ok', text: 'Team imported from share code.' });
      } else {
        const { team, warnings } = importShowdown(src, dex, format);
        if (!team.slots.some(Boolean)) throw new Error(warnings[0] ?? 'No Pokémon found in the pasted text.');
        addTeams([team]);
        setMsg({ kind: warnings.length ? 'err' : 'ok', text: warnings.length ? `Imported with notes: ${warnings.join(' ')}` : 'Showdown team imported.' });
      }
      if (!src.startsWith('{')) setTimeout(onDone, 600);
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message || 'Could not read that input.' });
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Paste a <b>Showdown export</b>, a <b>share code</b> (PTB1.…) or a <b>JSON backup</b>. Imported teams are added as new
        teams — nothing is overwritten.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Garchomp @ Garchompite\nAbility: Rough Skin\nEVs: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n…'}
        className="scrollbar-thin h-64 w-full resize-none rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs outline-none focus:border-accent"
      />
      {msg && <p className={cn('text-xs', msg.kind === 'ok' ? 'text-good' : 'text-warn')}>{msg.text}</p>}
      <div className="flex justify-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > MAX_IMPORT_BYTES) {
              setMsg({ kind: 'err', text: 'That file is too large to be a team export or backup.' });
              return;
            }
            try {
              run(await f.text());
            } catch {
              setMsg({ kind: 'err', text: 'Could not read that file.' });
            }
          }}
        />
        <Button onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> From file…
        </Button>
        <Button variant="primary" onClick={() => run(text)} disabled={!text.trim()}>
          Import
        </Button>
      </div>
    </div>
  );
}
