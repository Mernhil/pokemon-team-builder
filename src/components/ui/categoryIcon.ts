import { Shield, Swords, Zap } from 'lucide-react';

/** Icon per move category (Physical / Special / Status), shared by move lists and move cards. */
export const CATEGORY_ICON = { Physical: Swords, Special: Zap, Status: Shield } as const;
