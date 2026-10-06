import { createContext, useContext } from 'react';
import type { Dex } from '@/data/dex';
import type { AtlasFile, AtlasGame } from '@/domain/atlas';
import type { PokedexData } from '@/domain/pokedex';
import type { FormatRules } from '@/domain/types';

export interface AtlasCtx {
  file: AtlasFile;
  game: AtlasGame;
  dex: Dex;
  format: FormatRules;
  /** Pokédex encounter tables of the game's book (null while loading). */
  pokedex: PokedexData | null;
  /** Display name of a location id. */
  locName: (id: string | undefined) => string;
  itemName: (id: string) => string;
  speciesName: (id: string) => string;
  openLocation: (id: string) => void;
  openTrainer: (group: string) => void;
  openItem: (id: string) => void;
}

const Ctx = createContext<AtlasCtx | null>(null);
export const AtlasProvider = Ctx.Provider;
export function useAtlasCtx(): AtlasCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AtlasProvider missing');
  return c;
}
