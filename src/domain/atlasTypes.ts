/**
 * Shape of the generated atlas-<game>.json (`npm run atlas`). Types only, no imports, so the build
 * script and the app share one definition; the helpers live in atlas.ts.
 */

export type LocationKind = 'city' | 'town' | 'route' | 'sea-route' | 'cave' | 'dungeon' | 'landmark' | 'building' | 'roaming';

/** Everything the game source doesn't fully pin down is flagged; the UI shows an "unverified" badge. */
export type Verified = boolean;

export interface AtlasMon {
  species: string;
  /** Alternate form number as the game stores it (Rotom, Giratina, Shaymin, Wormadam, Deoxys…). */
  form?: number;
  level: number;
  item?: string;
  /** Four move ids (fewer when the learnset has fewer). */
  moves: string[];
  /** True when the game builds the moves itself: the last four level-up moves at this level. */
  movesDerived?: boolean;
  ability?: string;
  nature?: string;
  gender?: 'M' | 'F' | 'N';
  /** Every IV, 0–31 (the game sets one value for the whole team member). Gen 1–2: the DV. */
  iv: number;
  /** Gen 1–2: DVs per stat [hp, atk, def, spa, spd, spe] when the game fixes them individually. */
  dvs?: number[];
}

export type TrainerKind = 'trainer' | 'leader' | 'elite-four' | 'champion' | 'rival' | 'boss' | 'other';

export interface AtlasTrainer {
  id: string;
  name: string;
  /** Trainer class, e.g. "Bird Keeper". */
  cls: string;
  kind: TrainerKind;
  /** Location id this trainer stands in (map place id), when known. */
  loc?: string;
  double?: boolean;
  party: AtlasMon[];
  /** Items the trainer may use in battle. */
  bag?: string[];
  /** What they say before the battle / after losing (English). */
  quote?: { pre?: string; defeat?: string };
  /** Variant group: rematches and starter-dependent rivals share `group`; `variant` names this one. */
  group: string;
  variant?: string;
  /** Sort key inside a group (first battle before rematches). */
  order: number;
}

export interface AtlasItemSpot {
  item: string;
  qty: number;
  how: 'visible' | 'hidden' | 'gift' | 'tm' | 'hm' | 'mart' | 'berry';
  /** Where exactly, in words. */
  where: string;
  /** Tile coordinates in the map matrix (x, z) when the game gives them. */
  at?: [number, number];
  /** What you need first ("Surf", "Defeat Team Galactic"…). */
  requires?: string;
  respawns: boolean;
  /** The sub-map (building / floor) it is in. */
  sub?: string;
}

export interface AtlasShopItem {
  item: string;
  price: number;
  /** Common Poké Mart stock unlocks with badges: the number of badges needed. */
  badges?: number;
}

export interface AtlasShop {
  name: string;
  /** What this counter sells. */
  items: AtlasShopItem[];
  /** Stock depends on badge count (Poké Mart common stock). */
  badgeStock?: boolean;
}

export interface AtlasNpc {
  name: string;
  /** Sprite class shown as a hint ("Collector", "Lass"…). */
  sprite: string;
  sub?: string;
  /** Everything they say, in order of the script's branches (English). */
  says: string[];
  gives?: { item: string; qty: number }[];
  /** Pokémon they give, trade or teach. */
  giftMon?: { species: string; level: number; item?: string; moves?: string[] };
  /** "tutor" / "trade" / "gift" / "sign". */
  role?: 'npc' | 'sign' | 'tutor' | 'trade' | 'gift' | 'shop';
  trade?: { give: string; get: string; nickname?: string; item?: string };
}

export interface AtlasGym {
  leader: string;
  type?: string;
  badge: string;
  /** Highest level in the leader's team. */
  levelCap: number;
}

export interface AtlasLocation {
  id: string;
  name: string;
  kind: LocationKind;
  /** The in-game map ids (buildings, floors) rolled up into this location. */
  maps: string[];
  connections: string[];
  pokecenter: boolean;
  shops: AtlasShop[];
  gym?: AtlasGym;
  /** HM moves / obstacles present in the area ("Cut", "Rock Smash", "Strength"). */
  obstacles: string[];
  items: AtlasItemSpot[];
  npcs: AtlasNpc[];
  trainers: string[];
  /** The Town Map draws this place apart from another one (a sea route and its land route share one game map): everything is listed there. */
  sameAs?: string;
  /** Story / static events in plain words. */
  events: string[];
}

export interface AtlasItemInfo {
  name: string;
  price: number;
  description: string;
  pocket: string;
  /** TM / HM move id and its type (for the icon). */
  move?: string;
  moveType?: string;
}

export interface AtlasFile {
  version: 1;
  game: string;
  name: string;
  generation: number;
  source: { repo: string; commit: string };
  locations: Record<string, AtlasLocation>;
  trainers: Record<string, AtlasTrainer>;
  items: Record<string, AtlasItemInfo>;
  /** Decomp trainer ids that couldn't be placed on a location (Battle Frontier, unused maps…). */
  unplaced: string[];
  /**
   * Why each unplaced trainer has no location (trainer id → words): an unused slot, a battle
   * facility, a script shared by many maps, a rematch of one that has no map… so they are listed as
   * "Other trainers" instead of dropped. Absent in older files.
   */
  otherTrainers?: Record<string, string>;
  /** Badge order of the game, for progress and stock. */
  badges: string[];
  /** Fields the decomp doesn't settle: surfaced as "unverified" in the UI. */
  unverified: Record<string, string[]>;
}
