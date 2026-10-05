import { Suspense, lazy } from 'react';
import { Moon, Sparkles, Square, Sun } from 'lucide-react';
import { usePrefsStore } from '@/store/prefsStore';
import { useTeamStore } from '@/store/teamStore';
import { PaletteSettings } from './PaletteSettings';
import { UpdateCheckButton } from './DesktopUpdater';
import { Modal } from './ui/Modal';
import { Label, Tabs } from './ui/primitives';

// Cloud sync loads when Settings opens (its engine loads only once sync is on).
const SyncSettings = lazy(() => import('./SyncSettings'));

/**
 * Settings & credits: appearance, where data lives, and who made the data and art the app uses.
 * The app claims no ownership of any Pokémon asset.
 */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const theme = useTeamStore((s) => s.theme);
  const setTheme = useTeamStore((s) => s.setTheme);
  const look = usePrefsStore((s) => s.look);
  const setLook = usePrefsStore((s) => s.setLook);

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
          <Tabs
            label="Style"
            value={look}
            onChange={setLook}
            tabs={[
              { id: 'sticker', label: 'Sticker', icon: Sparkles },
              { id: 'classic', label: 'Classic', icon: Square },
            ]}
          />
          <PaletteSettings />
          <p className="text-xs text-muted">Motion follows your system’s “reduce motion” setting.</p>
        </section>

        <section className="space-y-1.5" aria-labelledby="set-data">
          <h3 id="set-data">
            <Label>Your data</Label>
          </h3>
          <p>
            Teams, the match log and your picker favourites are stored on this device, in this browser (or the desktop app). Nothing is uploaded
            unless you turn on <b>Sync</b> below. To move teams to another device without it, use <b>Import / Export → JSON backup</b> from the team menu.
          </p>
          <div className="flex items-center gap-2">
            <UpdateCheckButton />
          </div>
        </section>

        <section className="space-y-1.5" aria-labelledby="set-sync">
          <h3 id="set-sync">
            <Label>Sync</Label>
          </h3>
          <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
            <SyncSettings />
          </Suspense>
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
              Meta tab usage numbers: Pokémon Champions’ in-game <b>Battle Data</b> for the current ranked season (via the community mirror
              github.com/Gheist23/pokemonbattledata); <b>Smogon usage statistics</b> (smogon.com/stats), from rated Pokémon Showdown ladder battles; before a
              regulation’s first month is published, provisional numbers from <b>Limitless</b> tournament team lists (play.limitlesstcg.com),
              public <b>Pokémon Showdown replays</b> (replay.pokemonshowdown.com) or the previous regulation.
            </li>
            <li>
              Sprites, Pokédex text and locations: <b>PokeAPI</b> (sprites and CSV data).
            </li>
            <li>
              Wild encounter tables: <b>PKHeX</b> encounter data.
            </li>
            <li>
              Gen 1–4 region maps: rendered from the <b>pret</b> disassemblies (pokered, pokecrystal, pokeemerald, pokefirered, pokeplatinum). HeartGold / SoulSilver: the <b>pokeheartgold</b> decompilation. Omega Ruby / Alpha Sapphire, Let’s Go, Brilliant Diamond / Shining Pearl, Black / White (and 2), X / Y and Scarlet / Violet: screenshots of the games’ own maps, supplied by the project owner (positions approximate). The other regions are drawn schematics.
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
