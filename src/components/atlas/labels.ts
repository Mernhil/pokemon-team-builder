import type { AtlasTrainer } from '@/domain/atlas';

export const KIND_LABEL: Record<AtlasTrainer['kind'], string> = {
  trainer: 'Trainer',
  leader: 'Gym Leader',
  'elite-four': 'Elite Four',
  champion: 'Champion',
  rival: 'Rival',
  boss: 'Team Galactic',
  other: 'Other',
};
