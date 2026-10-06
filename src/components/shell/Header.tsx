import { Suspense, lazy, useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Eraser, FolderOpen, MoreHorizontal, Save, Search } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { FORMATS, currentRegulation } from '@/domain/formats';
import { gameInfo } from '@/domain/games';
import type { FormatRules, Team } from '@/domain/types';
import { toast } from '@/store/toastStore';
import { isSavedTeam } from '@/domain/team';
import { useTeamStore } from '@/store/teamStore';
import { UpdateCheckButton } from '../DesktopUpdater';
import { whenIdle } from '../ui/motion';
import { TopNav } from './Navigation';
import { GenBadge } from '../ui/GenBadge';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { Button } from '../ui/primitives';
import { buttonClass, controlClass } from '../ui/styles';

// Dialogs load the first time they open (they carry the import/export codecs and the saved-teams list), not with the first screen.
// Fetched when the browser is idle after start-up, so opening one is instant and the first screen doesn't wait for them.
const preloadDialogs = () => void Promise.all([import('../io/TeamsDialog'), import('../io/SaveTeamDialog'), import('../io/ImportExportDialog'), import('../settings/SettingsDialog')]).catch(() => undefined);
const ImportExportDialog = lazy(() => import('../io/ImportExportDialog').then((m) => ({ default: m.ImportExportDialog })));
const SaveTeamDialog = lazy(() => import('../io/SaveTeamDialog').then((m) => ({ default: m.SaveTeamDialog })));
const TeamsDialog = lazy(() => import('../io/TeamsDialog').then((m) => ({ default: m.TeamsDialog })));

function FormatBadge({ format }: { format: FormatRules }) {
  const game = gameInfo(format.game);
  if (game)
    return (
      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs font-bold tracking-wide text-muted uppercase" title={game.name}>
        {game.shortName}
      </span>
    );
  if (format.datasetId === 'champions')
    return <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs font-bold tracking-wide text-accent uppercase">Champions</span>;
  return <GenBadge gen={format.generation} />;
}

export function Header({ team, format, dex, onOpenSettings, onOpenPalette }: { team: Team; format: FormatRules; dex?: Dex; onOpenSettings: () => void; onOpenPalette: () => void }) {
  const { switchFormat, saveTeam, clearTeam, restoreSlots, newTeam, selectTeam, deleteTeam } = useTeamStore.getState();
  const isEmpty = team.slots.every((s) => s === null);
  useEffect(() => whenIdle(preloadDialogs), []);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const liveRegId = currentRegulation()?.id;

  const clearWithUndo = () => {
    // Edits save into the open team as you go, so wiping a saved or named team would wipe the saved one:
    // start a fresh team instead and leave it where it is. Only the scratch draft is emptied in place.
    if (isSavedTeam(team)) {
      const kept = team;
      const fresh = newTeam(team.formatId);
      toast(`Started a new team. “${kept.name}” is still in Saved teams.`, {
        label: 'Undo',
        run: () => {
          selectTeam(kept.id);
          deleteTeam(fresh);
        },
      });
      return;
    }
    const before = team.slots;
    const link = { editingFrom: useTeamStore.getState().editingFrom, editingDraft: useTeamStore.getState().editingDraft };
    clearTeam(team.id);
    // A cleared build is a fresh start: Save no longer offers to update the team it came from.
    useTeamStore.setState({ editingFrom: null, editingDraft: null });
    toast('Cleared the team.', {
      label: 'Undo',
      run: () => {
        restoreSlots(team.id, before);
        useTeamStore.setState(link);
      },
    });
  };

  const formatSelect = (
    <select
      aria-label="Game and format"
      className={controlClass(false, 'w-full min-w-0 px-2 sm:w-auto sm:max-w-[20rem] sm:shrink')}
      value={format.id}
      onChange={(e) => switchFormat(team.id, e.target.value)}
    >
      {[
        { label: 'Pokémon Champions', formats: FORMATS.filter((f) => f.datasetId === 'champions') },
        { label: 'Main series · Gen 1–9', formats: FORMATS.filter((f) => f.datasetId !== 'champions' && !f.game) },
        { label: "Main series · Let's Go, BDSP, Legends", formats: FORMATS.filter((f) => f.game) },
      ].map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.formats.map((f) => (
            <option key={f.id} value={f.id} disabled={!f.available}>
              {f.name}
              {f.regulationId && f.regulationId === liveRegId ? ' (live)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="status-band" aria-hidden />
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <span className="hidden items-center gap-2 md:flex">
          <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-accent)" strokeWidth="3" />
            <path d="M2 16h9M21 16h9" stroke="var(--color-accent)" strokeWidth="3" />
            <circle cx="16" cy="16" r="4.5" fill="var(--color-accent)" />
          </svg>
          <span className="hidden text-sm font-bold tracking-tight lg:inline">Team Builder</span>
        </span>
        <TopNav onOpenSettings={onOpenSettings} />

        {/* The team being edited and its format: inline from xl up, a second row below that. */}
        <div className="order-last flex w-full min-w-0 items-center gap-2 xl:order-none xl:w-auto xl:flex-1">
          <span className="hidden sm:inline-flex">
            <FormatBadge format={format} />
          </span>
          {formatSelect}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className={buttonClass('default', 'icon')} onClick={onOpenPalette} aria-label="Search (Ctrl K)" title="Search · Ctrl/⌘ K">
            <Search size={17} aria-hidden />
          </button>
          <UpdateCheckButton />
          <Button variant="primary" onClick={() => setSaveOpen(true)}>
            {justSaved ? <Check size={15} aria-hidden /> : <Save size={15} aria-hidden />}
            {justSaved ? 'Saved' : 'Save'}
          </Button>
          <Menu
            label="Team actions"
            trigger={
              <button type="button" className={buttonClass('default', 'icon')}>
                <MoreHorizontal size={18} aria-hidden />
              </button>
            }
          >
            <MenuItem icon={FolderOpen} onSelect={() => setTeamsOpen(true)}>
              Saved teams
            </MenuItem>
            <MenuItem icon={ArrowLeftRight} disabled={!dex} onSelect={() => setIoOpen(true)}>
              Import / Export
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Eraser} disabled={isEmpty} tone="danger" onSelect={clearWithUndo}>
              Clear this team
            </MenuItem>
          </Menu>
        </div>
      </div>
      {teamsOpen && (
        <Suspense fallback={null}>
          <TeamsDialog open={teamsOpen} onOpenChange={setTeamsOpen} dex={dex} />
        </Suspense>
      )}
      {saveOpen && (
        <Suspense fallback={null}>
        <SaveTeamDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          currentName={team.name}
          onSave={(name, mode, targetId) => {
            saveTeam(name, mode, targetId);
            setJustSaved(true);
            toast(mode === 'overwrite' ? `Overwrote “${name}”.` : mode === 'variation' ? `Added a variation to “${name}”.` : `Saved “${name}” to your teams.`);
            window.setTimeout(() => setJustSaved(false), 1500);
          }}
        />
        </Suspense>
      )}
      {dex && ioOpen && (
        <Suspense fallback={null}>
          <ImportExportDialog open={ioOpen} onOpenChange={setIoOpen} team={team} dex={dex} format={format} />
        </Suspense>
      )}
    </header>
  );
}
