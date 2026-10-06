import { RotateCcw } from 'lucide-react';
import { CHROMA_RANGE, DEFAULT_PALETTE_ID, PALETTE_PRESETS, paletteTokens, presetOf, type Palette } from '@/domain/palette';
import { usePrefsStore } from '@/store/prefsStore';
import { Button, Label } from '../ui/primitives';
import { cn } from '../ui/styles';

const HUE_TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => `oklch(0.72 0.15 ${i * 30})`).join(', ')})`;
const FALLBACK: Palette = { hue: 268, chroma: 0.15 };

/** Settings → Appearance: ready-made palettes as a base, plus sliders to tune the hue and how vivid it is. */
export function PaletteSettings() {
  const palette = usePrefsStore((s) => s.palette);
  const setPalette = usePrefsStore((s) => s.setPalette);
  const current = palette ?? FALLBACK;
  const preset = presetOf(palette);
  const swatch = (p: Palette) => paletteTokens(p, 'dark').accent;

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Colour palette" className="flex flex-wrap gap-2">
        {PALETTE_PRESETS.map((p) => {
          const active = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => setPalette(p.id === DEFAULT_PALETTE_ID ? null : p)}
              className={cn(
                'hit flex h-9 items-center gap-2 rounded-full border bg-surface px-3 text-sm font-medium transition-colors',
                active ? 'border-accent text-fg ring-2 ring-accent/40' : 'border-border-strong text-muted hover:text-fg',
              )}
            >
              <span className="size-4 rounded-full" style={{ background: swatch(p) }} aria-hidden />
              {p.name}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="flex items-baseline justify-between text-xs text-muted">
            <Label>Colour</Label>
            <span className="font-mono tabular-nums">{current.hue}°</span>
          </span>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={current.hue}
            aria-label="Hue"
            onChange={(e) => setPalette({ ...current, hue: Number(e.target.value) })}
            className="palette-range w-full"
            style={{ background: HUE_TRACK }}
          />
        </label>
        <label className="block space-y-1">
          <span className="flex items-baseline justify-between text-xs text-muted">
            <Label>Vividness</Label>
            <span className="font-mono tabular-nums">{Math.round((current.chroma / CHROMA_RANGE.max) * 100)}%</span>
          </span>
          <input
            type="range"
            min={CHROMA_RANGE.min}
            max={CHROMA_RANGE.max}
            step={0.005}
            value={current.chroma}
            aria-label="Vividness"
            onChange={(e) => setPalette({ ...current, chroma: Number(e.target.value) })}
            className="palette-range w-full"
            style={{ background: `linear-gradient(to right, oklch(0.72 0 ${current.hue}), oklch(0.72 ${CHROMA_RANGE.max} ${current.hue}))` }}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Text and buttons adjust themselves so they stay readable at any setting.</p>
        <Button size="sm" variant="ghost" onClick={() => setPalette(null)} disabled={palette === null}>
          <RotateCcw size={14} aria-hidden /> Reset
        </Button>
      </div>
    </div>
  );
}
