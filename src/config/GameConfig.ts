import type { GameConfig as IGameConfig } from '@/types';

export const DEFAULT_GAME_CONFIG: IGameConfig = {
  seed: 'NEURAL_ONSLAUGHT',
  systemCount: 30,
  overmindSpeed: 1.0,
};

export const MAX_STAR_SYSTEMS = 30;
export const MAX_ENEMIES_PER_ENCOUNTER = 6;
export const MAX_MODULE_SLOTS = 3;
export const MAX_DIALOGUE_HISTORY = 50;
export const MAX_SAVE_SLOTS = 10;
export const CHAOS_GATE_DURATION_DAYS = 5;
export const OVERMIND_EVOLUTION_MIN = 0.5;
export const OVERMIND_EVOLUTION_MAX = 2.0;
export const PRICE_MODIFIER_MIN = 0.3;
export const PRICE_MODIFIER_MAX = 3.0;
export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;
export const MAX_RESOURCE_STACK = 999_999;
export const GALAXY_SEED_REGEX = /^[A-Za-z0-9]{8,32}$/;
