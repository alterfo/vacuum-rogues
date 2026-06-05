import { z } from "zod";

import { logger } from "@/utils/logger";

export const AxialCoordSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
});

export const EmotionVectorSchema = z.object({
  trust: z.number(),
  fear: z.number(),
  respect: z.number(),
  hostility: z.number(),
  curiosity: z.number(),
});

export const PlayerSettingsSchema = z.object({
  volume: z.number().int().min(0).max(100).default(100),
  graphicsQuality: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  keyBindings: z.record(z.string()).optional(),
});

export type PlayerSettings = z.infer<typeof PlayerSettingsSchema>;

export function validatePlayerSettings(data: unknown): PlayerSettings {
  const result = PlayerSettingsSchema.safeParse(data);
  if (!result.success) {
    logger.warn("Invalid player settings, using defaults:", result.error);
    return PlayerSettingsSchema.parse({});
  }
  return result.data;
}

export const ShipModuleSchema = z.object({
  // Module ids are stable semantic identifiers (e.g. "weapon_laser_1"), not
  // UUIDs — requiring .uuid() here rejected every valid save on load.
  id: z.string().min(1),
  category: z.enum(["WEAPON", "SHIELD", "ENGINE"]),
  name: z.string(),
  effect: z.object({
    type: z.string(),
    value: z.number(),
  }),
  level: z.number().int().min(1),
});

export const PlayerShipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(32),
  hullHP: z.number().int().min(0),
  maxHull: z.number().int().positive(),
  shields: z.number().int().min(0),
  maxShields: z.number().int().positive(),
  energy: z.number().int().min(0),
  maxEnergy: z.number().int().positive(),
  speed: z.number(),
  evasion: z.number(),
  modules: z.tuple([
    ShipModuleSchema.nullable(),
    ShipModuleSchema.nullable(),
    ShipModuleSchema.nullable(),
  ]),
});

export const ResourceStackSchema = z.object({
  type: z.enum([
    "FUEL",
    "METALS",
    "CRYSTALS",
    "ORGANICS",
    "ARTIFACTS",
    "WEAPONS",
    "MEDICINE",
    "ELECTRONICS",
    "LUXURY",
    "DATA_CORES",
  ]),
  amount: z.number().int().min(0).max(999_999),
});

export const InventorySchema = z.object({
  modules: z.array(ShipModuleSchema),
  resources: z.array(ResourceStackSchema),
  cosmetics: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const QuestObjectiveSchema = z.object({
  id: z.string(),
  description: z.string(),
  targetAmount: z.number().int().positive(),
  currentAmount: z.number().int().min(0),
  completed: z.boolean(),
});

export const QuestFailurePenaltySchema = z.object({
  reputationLoss: z.number().int().min(0),
  creditsFine: z.number().int().min(0).optional(),
  jailTime: z.number().int().min(0).optional(),
  description: z.string(),
});

export const QuestSchema = z.object({
  // Quest ids are semantic template ids (e.g. "quest_delivery_ore"), not UUIDs.
  id: z.string().min(1),
  title: z.string(),
  type: z.enum([
    "DELIVERY",
    "BOUNTY",
    "ESCORT",
    "DIPLOMACY",
    "EXPLORATION",
    "TEXT_ADVENTURE",
  ]),
  objectives: z.array(QuestObjectiveSchema),
  isCompleted: z.boolean(),
  isFailed: z.boolean(),
  planetId: z.string(),
  issuedDay: z.number().int().min(0),
  deadline: z.number().int().min(0), // 0 = no deadline
  failurePenalty: QuestFailurePenaltySchema.nullable(),
});

export const QuestLogSchema = z.object({
  activeQuests: z.array(QuestSchema),
  // QuestManager tracks completed quests by id only, so persist ids (not full
  // Quest objects) to match the runtime shape.
  completedQuests: z.array(z.string()),
});

export const JournalEntrySchema = z.object({
  // Journal entry ids are stable string ids, not necessarily UUIDs.
  id: z.string().min(1),
  date: z.number().int(),
  text: z.string(),
});

export const JournalSchema = z.object({
  entries: z.array(JournalEntrySchema),
});

export const ReputationMapSchema = z.record(
  z.string(),
  z.number().min(-100).max(100),
);

export const PlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(32),
  experience: z.number().int().min(0),
  level: z.number().int().min(1).max(99),
  credits: z.number().int().min(0),
  reputation: ReputationMapSchema,
  questLog: QuestLogSchema,
  journal: JournalSchema,
  ship: PlayerShipSchema,
  inventory: InventorySchema,
  currentSystemId: z.string().optional().default(""),
});

export const StarSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  coordinates: AxialCoordSchema,
  starType: z.enum([
    "RED_DWARF",
    "YELLOW_DWARF",
    "BLUE_GIANT",
    "WHITE_DWARF",
    "NEUTRON",
    "BLACK_HOLE",
  ]),
  explored: z.boolean(),
  fogOfWar: z.boolean(),
});

export const NpcGoalSchema = z.object({
  kind: z.enum(["TRAVEL", "TRADE", "QUEST", "PATROL", "HUNT"]),
  targetSystemId: z.string().optional(),
  questId: z.string().optional(),
});

export const NpcShipSchema = z.object({
  id: z.string(),
  name: z.string(),
  race: z.enum([
    "OUTLANDERS",
    "BASTIONS",
    "SYNDICATE",
    "PARADOXES",
    "PROGRESSORS",
  ]),
  faction: z.enum([
    "OUTLANDERS",
    "BASTIONS",
    "SYNDICATE",
    "PARADOXES",
    "PROGRESSORS",
    "INDEPENDENT",
    "OVERMIND",
  ]),
  role: z.enum(["RANGER", "TRADER", "PIRATE", "PATROL"]),
  hullHP: z.number(),
  maxHull: z.number(),
  shields: z.number(),
  speed: z.number(),
  damage: z.number(),
  currentSystemId: z.string(),
  state: z.enum([
    "IDLE",
    "TRAVELING",
    "TRADING",
    "QUESTING",
    "PATROLLING",
    "FIGHTING",
    "DEAD",
  ]),
  goal: NpcGoalSchema.nullable(),
  destinationSystemId: z.string().nullable(),
  daysToArrival: z.number(),
  credits: z.number(),
  reputation: z.number(),
});

export const GalaxySchema = z.object({
  id: z.string(),
  gameDays: z.number().int().min(0),
  systems: z.array(StarSystemSchema).min(1).max(100),
  npcShips: z.array(NpcShipSchema).default([]),
});

export const DialogueSessionSchema = z.object({
  id: z.string(),
  history: z.array(
    z.object({
      sender: z.enum(["PLAYER", "NPC"]),
      text: z.string(),
      timestamp: z.number().int(),
    }),
  ),
  currentEmotion: EmotionVectorSchema,
});

export const SaveStateSchema = z.object({
  version: z.number().int().positive(),
  timestamp: z.number().int(),
  galaxy: GalaxySchema,
  player: PlayerSchema,
  persistentDialogs: z.array(DialogueSessionSchema),
  currentSceneType: z.string().optional(),
});

export function validateSaveState(
  data: unknown,
): z.infer<typeof SaveStateSchema> {
  return SaveStateSchema.parse(data);
}
