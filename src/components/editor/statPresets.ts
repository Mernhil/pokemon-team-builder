import { type StatSystem, type StatTable } from '@/domain/types';

export type Preset = { label: string; spread: Partial<StatTable> };

export const PRESETS: Record<StatSystem['kind'], Preset[]> = {
  'champions-sp': [
    { label: 'Physical sweeper', spread: { hp: 2, atk: 32, spe: 32 } },
    { label: 'Special sweeper', spread: { hp: 2, spa: 32, spe: 32 } },
    { label: 'Bulky physical', spread: { hp: 32, atk: 32, def: 2 } },
    { label: 'Bulky special', spread: { hp: 32, spa: 32, spd: 2 } },
    { label: 'Max bulk', spread: { hp: 32, def: 17, spd: 17 } },
    { label: 'Trick Room', spread: { hp: 32, atk: 32, def: 2 } },
  ],
  'modern-ev': [
    { label: 'Physical sweeper', spread: { hp: 4, atk: 252, spe: 252 } },
    { label: 'Special sweeper', spread: { hp: 4, spa: 252, spe: 252 } },
    { label: 'Bulky physical', spread: { hp: 252, atk: 252, def: 4 } },
    { label: 'Bulky special', spread: { hp: 252, spa: 252, spd: 4 } },
    { label: 'Physically defensive', spread: { hp: 252, def: 252, spd: 4 } },
    { label: 'Specially defensive', spread: { hp: 252, def: 4, spd: 252 } },
  ],
  'gb-statexp': [{ label: 'Max all (trained)', spread: { hp: 65535, atk: 65535, def: 65535, spa: 65535, spd: 65535, spe: 65535 } }],
  'lgpe-av': [{ label: 'Max all AVs (200)', spread: { hp: 200, atk: 200, def: 200, spa: 200, spd: 200, spe: 200 } }],
  'pla-effort': [{ label: 'Max all Effort Levels (10)', spread: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 } }],
};
