import { useSpriteSheet } from '@/data/sprites';
import type { SpriteSetId, TeraType } from '@/domain/types';
import { MonAvatar, TYPE_COLORS } from './primitives';

interface Props {
  speciesId?: string;
  name?: string;
  types?: TeraType[];
  set: SpriteSetId;
  size?: number;
  /** Draw a soft type-coloured disc behind the sprite. */
  backdrop?: boolean;
  className?: string;
}

/**
 * Renders one cell of a sprite atlas via background-position. Falls back to the initials avatar
 * while the sheet loads or if the species isn't in that set.
 */
export function Sprite({ speciesId, name, types, set, size = 48, backdrop, className }: Props) {
  const sheet = useSpriteSheet(set);
  const idx = speciesId && sheet ? sheet.index[speciesId] : undefined;

  if (!speciesId || !sheet || idx === undefined) {
    return <MonAvatar name={speciesId ? name : undefined} types={types} size={size} />;
  }
  const scale = size / sheet.cell;
  const x = (idx % sheet.cols) * sheet.cell * scale;
  const y = Math.floor(idx / sheet.cols) * sheet.cell * scale;

  return (
    <div
      className={`relative shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name ? `${name} sprite` : 'Pokémon sprite'}
    >
      {backdrop && (
        <div
          className="absolute inset-[8%] rounded-full opacity-30"
          style={{
            background: `radial-gradient(circle at 50% 62%, ${types?.[0] ? TYPE_COLORS[types[0]] : 'var(--color-muted)'}, transparent 70%)`,
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${sheet.url})`,
          backgroundPosition: `-${x}px -${y}px`,
          backgroundSize: `${sheet.cols * sheet.cell * scale}px ${sheet.rows * sheet.cell * scale}px`,
          backgroundRepeat: 'no-repeat',
          imageRendering: sheet.pixelated ? 'pixelated' : 'auto',
        }}
      />
    </div>
  );
}
