import { useState } from 'react';
import { MAX_SET_NOTES } from '@/domain/sanitize';
import type { PokemonSet } from '@/domain/types';
import { Disclosure, TextArea } from '../ui/primitives';

/** "Why this spread": a few lines of the player's own, kept on the Pokémon (and in its share code and sync). Folds away when empty. */
export function SetNotes({ set, onChange }: { set: PokemonSet; onChange: (notes: string | undefined) => void }) {
  const [text, setText] = useState(set.notes ?? '');
  return (
    <Disclosure title="Notes" summary={set.notes ? set.notes.split('\n')[0].slice(0, 60) : 'why this spread, how to play it'} defaultOpen={!!set.notes}>
      <label className="block space-y-1 pt-1">
        <span className="sr-only">Notes about this Pokémon</span>
        <TextArea
          rows={3}
          maxLength={MAX_SET_NOTES}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onChange(text.trim() || undefined)}
          placeholder="Why this spread: e.g. Max Speed to outrun Scarf Flutter Mane; survives Garchomp's Earthquake."
          aria-label="Notes about this Pokémon"
        />
        <span className="block text-right text-xs text-muted">{text.length}/{MAX_SET_NOTES}</span>
      </label>
    </Disclosure>
  );
}
