import { Suspense, lazy } from 'react';
import { Moon, Sparkles, Square, Sun } from 'lucide-react';
import { DEFAULT_NAV, NAV_IDS, NAV_LABELS, NAV_LIMITS, resizeBar, setSlot, type NavKind } from '@/domain/navigation';
import { usePrefsStore } from '@/store/prefsStore';
import { useTeamStore } from '@/store/teamStore';
import { PaletteSettings } from './PaletteSettings';
import { UpdateCheckButton } from './DesktopUpdater';
import { Modal } from './ui/Modal';
import { Button, Label, Select, Tabs } from './ui/primitives';

// Cloud sync loads when Settings opens (its engine loads only once sync is on).
const SyncSettings = lazy(() => import('./SyncSettings'));

/**
 * Settings & credits: appearance, where data lives, and who made the data and art the app uses.
 * The app claims no ownership of any Pokémon asset.
 */
export function SettingsDialog({ open, onOpenChange, onOpenWhatsNew }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenWhatsNew: () => void }) {
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

        <section className="space-y-2" aria-labelledby="set-nav">
          <h3 id="set-nav">
            <Label>Navigation</Label>
          </h3>
          <p className="text-xs text-muted">
            Choose what the main bar shows. Everything else stays under <b>More</b>. For Pokémon Champions, Pokénav is replaced by Reverse search.
          </p>
          <NavEditor kind="phone" title="Phone (bottom bar)" />
          <NavEditor kind="desktop" title="Desktop and tablet (top bar)" />
        </section>

        <section className="space-y-1.5" aria-labelledby="set-whatsnew">
          <h3 id="set-whatsnew">
            <Label>What’s new</Label>
          </h3>
          <p>What changed in the latest releases.</p>
          <Button onClick={onOpenWhatsNew}>
            <Sparkles size={15} aria-hidden />
            What’s new
          </Button>
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

/** The slots of one bar: a picker per slot (choosing something already in the bar swaps the two), add, remove, reset. */
function NavEditor({ kind, title }: { kind: NavKind; title: string }) {
  const saved = usePrefsStore((s) => s.nav[kind]);
  const setNav = usePrefsStore((s) => s.setNav);
  const resetNav = usePrefsStore((s) => s.resetNav);
  // Edited as stored (Pokénav stays Pokénav here; Champions swaps it only where it's shown).
  const ids = saved ?? DEFAULT_NAV[kind];
  const { min, max } = NAV_LIMITS[kind];
  return (
    <fieldset className="space-y-1.5 rounded-lg border border-border p-2.5">
      <legend className="px-1 text-xs font-semibold">{title}</legend>
      {ids.map((id, i) => (
        <label key={i} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-muted">Slot {i + 1}</span>
          <Select aria-label={`${title}, slot ${i + 1}`} value={id} onChange={(e) => setNav(kind, setSlot(ids, i, e.target.value as (typeof NAV_IDS)[number]))} className="w-full">
            {NAV_IDS.map((n) => (
              <option key={n} value={n}>
                {NAV_LABELS[n]}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setNav(kind, resizeBar(ids, kind, 1))} disabled={ids.length >= max}>
          Add a slot
        </Button>
        <Button size="sm" onClick={() => setNav(kind, resizeBar(ids, kind, -1))} disabled={ids.length <= min}>
          Remove a slot
        </Button>
        <Button size="sm" variant="ghost" onClick={() => resetNav(kind)} disabled={!saved}>
          Reset
        </Button>
      </div>
    </fieldset>
  );
}
