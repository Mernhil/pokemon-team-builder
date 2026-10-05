import { Copy, Printer } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { teamSheetText } from '@/domain/teamSheet';
import type { FormatRules, Team } from '@/domain/types';
import { toast } from '@/store/toastStore';
import { Button, Panel } from '../ui/primitives';

/**
 * The team as one printable page (print CSS in index.css shows only `.team-sheet`, in black on white
 * whatever the theme) and "Copy as text" for a chat: sets, notes, Speed order, matchup notes and the Showdown export.
 */
export function TeamSheet({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const text = teamSheetText(team, dex, format);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Team sheet copied.');
    } catch {
      toast('Couldn’t copy; select the text and copy it by hand.');
    }
  };
  return (
    <Panel
      title="Team sheet"
      actions={
        <span className="flex gap-2 print:hidden">
          <Button size="sm" onClick={copy}>
            <Copy size={14} aria-hidden /> Copy as text
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer size={14} aria-hidden /> Print
          </Button>
        </span>
      }
    >
      <pre className="team-sheet max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap" tabIndex={0} aria-label="Team sheet text">{text}</pre>
    </Panel>
  );
}
