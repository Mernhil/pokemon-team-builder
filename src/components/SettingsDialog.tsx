import { Moon, Sun } from 'lucide-react';
import { useTeamStore } from '@/store/teamStore';
import { UpdateCheckButton } from './DesktopUpdater';
import { Modal } from './ui/Modal';
import { Label, Tabs } from './ui/primitives';

/**
 * Settings & credits: appearance, where data lives, and who made the data and art the app uses.
 * The app claims no ownership of any Pokémon asset.
 */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const theme = useTeamStore((s) => s.theme);
  const setTheme = useTeamStore((s) => s.setTheme);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Settings & credits" description={`Pokémon Team Builder v${__APP_VERSION__}`}>
      <div className="space-y-6 text-sm">
        <section className="space-y-2" aria-labelledby="set-appearance">
          <h3 id="set-appearance">
            <Label>Appearance</Label>
          </h3>
          <Tabs
            label="Theme"
            value={theme}
            onChange={setTheme}
            tabs={[
              { id: 'light', label: 'Light', icon: Sun },
              { id: 'dark', label: 'Dark', icon: Moon },
            ]}
          />
          <p className="text-xs text-muted">Motion follows your system’s “reduce motion” setting.</p>
        </section>

        <section className="space-y-1.5" aria-labelledby="set-data">
          <h3 id="set-data">
            <Label>Your data</Label>
          </h3>
          <p>
            Teams, the match log and your picker favourites are stored only on this device, in this browser (or the desktop app). Nothing is
            uploaded. To move teams to another device, use <b>Import / Export → JSON backup</b> from the team menu.
          </p>
          <div className="flex items-center gap-2">
            <UpdateCheckButton />
          </div>
        </section>

        <section className="space-y-1.5" aria-labelledby="set-credits">
          <h3 id="set-credits">
            <Label>Credits</Label>
          </h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Pokémon, move, ability and item data: <b>Pokémon Showdown</b> (Smogon) via <b>@pkmn/dex</b> and <b>@pkmn/mods</b>, MIT licence.
            </li>
            <li>
              Damage calculation: <b>@smogon/calc</b>, MIT licence.
            </li>
            <li>
              Sprites, Pokédex text and locations: <b>PokeAPI</b> (sprites and CSV data).
            </li>
            <li>
              Wild encounter tables: <b>PKHeX</b> encounter data.
            </li>
            <li>
              Gen 1–3 region maps: rendered from the <b>pret</b> disassemblies (pokered, pokecrystal, pokeemerald, pokefirered).
            </li>
            <li>Champions regulations: official Pokémon announcements, cross-checked as listed in each regulation’s sources.</li>
          </ul>
          <p className="text-xs text-muted">
            Pokémon and all related names, sprites and maps are trademarks and © of Nintendo, Creatures Inc. and GAME FREAK inc. This is a free,
            non-commercial fan tool, not affiliated with or endorsed by them, and it claims no ownership of their assets.
          </p>
        </section>
      </div>
    </Modal>
  );
}
