import { useItemSheet } from '@/data/sprites';

interface Props {
  itemId?: string;
  name?: string;
  size?: number;
  className?: string;
}

/**
 * Renders one cell of the item icon atlas via background-position. Renders nothing while the
 * sheet loads or if the item isn't in the atlas (e.g. no item held).
 */
export function ItemSprite({ itemId, name, size = 20, className }: Props) {
  const sheet = useItemSheet();
  const idx = itemId && sheet ? sheet.index[itemId] : undefined;

  if (!itemId || !sheet || idx === undefined) return null;

  const scale = size / sheet.cell;
  const x = (idx % sheet.cols) * sheet.cell * scale;
  const y = Math.floor(idx / sheet.cols) * sheet.cell * scale;

  return (
    <div
      className={`relative shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name ? `${name} icon` : 'Item icon'}
    >
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
