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

export const MicroModuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  targetCategory: z.enum(["WEAPON", "SHIELD", "ENGINE", "EQUIPMENT", "HULL"]),
  bonusType: z.string(),
  bonusTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const ShipModuleSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["WEAPON", "SHIELD", "ENGINE", "EQUIPMENT"]),
  name: z.string(),
  effect: z.object({
    type: z.string(),
    value: z.number(),
  }),
  level: z.number().int().min(1),
  micromoduleId: z.string().optional(),
  upgrades: z.number().int().min(0).max(2).optional(),
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
  hullClass: z
    .enum([
      "LIGHT_FIGHTER",
      "CORVETTE",
      "FRIGATE",
      "DESTROYER",
      "TRANSPORT",
      "HEAVY_FREIGHTER",
      "CRUISER",
    ])
    .default("CORVETTE"),
  modules: z
    .tuple([
      ShipModuleSchema.nullable(),
      ShipModuleSchema.nullable(),
      ShipModuleSchema.nullable(),
    ])
    .optional(),
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
  micromodules: z.array(MicroModuleSchema).default([]),
  resources: z.array(ResourceStackSchema),
  cosmetics: z.array(z.object({ id: z.string(), name: z.string() })),
  ownedGearIds: z.array(z.string()).default([]),
  ownedConsumableIds: z.array(z.string()).default([]),
});

export const QuestObjectiveSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z
    .enum(["COLLECT_ITEM", "VISIT_LOCATION", "VISIT_SYSTEM", "DEFEAT_ENEMY"])
    .default("COLLECT_ITEM"),
  targetAmount: z.number().int().positive(),
  currentAmount: z.number().int().min(0),
  completed: z.boolean(),
  itemType: z.string().optional(),
  locationId: z.string().optional(),
  targetSystemId: z.string().optional(),
  enemyType: z.string().optional(),
});

export const QuestFailurePenaltySchema = z.object({
  reputationLoss: z.number().int().min(0),
  creditsFine: z.number().int().min(0).optional(),
  jailTime: z.number().int().min(0).optional(),
  description: z.string(),
});

export const QuestSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  type: z.enum([
    "DELIVERY",
    "BOUNTY",
    "ESCORT",
    "DIPLOMACY",
    "EXPLORATION",
    "TEXT_ADVENTURE",
    "DEFENSE",
  ]),
  objectives: z.array(QuestObjectiveSchema),
  isCompleted: z.boolean(),
  isFailed: z.boolean(),
  isPendingReturn: z.boolean().default(false),
  planetId: z.string(),
  issuedDay: z.number().int().min(0),
  deadline: z.number().int().min(0), // 0 = no deadline
  failurePenalty: QuestFailurePenaltySchema.nullable(),
  targetSystemId: z.string().nullable().default(null),
  targetObjectId: z.string().nullable().default(null),
  targetPlanetId: z.string().nullable().default(null),
  minReputation: z.number().int().min(0).default(0),
  chainId: z.string().nullable().default(null),
  chainPart: z.number().int().default(-1),
  factionId: z.string().default(""),
});

export const QuestLogSchema = z.object({
  activeQuests: z.array(QuestSchema),
  completedQuests: z.array(z.string()),
  completedChainParts: z
    .record(z.string(), z.array(z.number().int()))
    .default({}),
  pendingReturnQuests: z.array(QuestSchema).default([]),
});

export const JournalEntrySchema = z.object({
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

export const QuestConditionSchema = z.object({
  type: z.enum(["credits", "reputation", "item"]),
  comparison: z.enum([">=", "<=", "==", ">"]),
  value: z.number(),
  factionId: z.string().optional(),
  itemId: z.string().optional(),
});

const QuestOutcomeSchema = z.object({
  creditsDelta: z.number(),
  reputationDelta: z.number(),
  factionId: z.string().optional(),
  itemGained: z.string().optional(),
  itemLost: z.string().optional(),
  journalEntry: z.string(),
});

export const TextQuestStateSchema = z.object({
  questId: z.string(),
  currentNodeId: z.string(),
  pendingOutcomes: z.array(QuestOutcomeSchema).default([]),
});

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
  contrabandGoods: z.array(z.string()).default([]),
  completedQuestChains: z.array(z.string()).default([]),
  activeTextQuestState: TextQuestStateSchema.nullable().default(null),
  newsBookmarks: z.array(z.number().int().min(0)).default([]),
  killPoints: z.number().int().min(0).default(0),
  rank: z.number().int().min(0).max(7).default(0),
  visitedSystems: z.array(z.string()).default([]),
  landedPlanetId: z.string().nullable().default(null),
  faction: z
    .enum(["OUTLANDERS", "BASTIONS", "SYNDICATE", "PARADOXES", "PROGRESSORS"])
    .default("OUTLANDERS"),
  gameMode: z.enum(["GOD", "NORMAL", "HARD"]).default("NORMAL"),
});

export const StationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum([
    "TRADE_POST",
    "REPAIR_DOCK",
    "MILITARY_BASE",
    "RESEARCH_LAB",
    "CRAFT_CENTER",
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
  orbitRadius: z.number(),
  orbitAngle: z.number(),
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
  economyType: z.enum(["AGRICULTURAL", "INDUSTRIAL", "MIXED"]).default("MIXED"),
  politicalSystem: z
    .enum(["ANARCHY", "DICTATORSHIP", "MONARCHY", "REPUBLIC", "DEMOCRACY"])
    .default("REPUBLIC"),
  lastVisitedDay: z.number().int().optional(),
  isFactionHome: z.boolean().default(false),
  homeFactionId: z
    .enum([
      "OUTLANDERS",
      "BASTIONS",
      "SYNDICATE",
      "PARADOXES",
      "PROGRESSORS",
      "INDEPENDENT",
      "OVERMIND",
    ])
    .nullable()
    .default(null),
  stations: z.array(StationSchema).default([]),
  techLevel: z.number().int().min(1).max(8).default(1),
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
  role: z.enum(["RANGER", "TRADER", "PIRATE", "PATROL", "OVERMIND"]),
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
  shieldPower: z.number().default(0),
  loadoutSummary: z.array(z.string()).default([]),
  cargo: z
    .array(z.object({ goodId: z.string(), qty: z.number().int().min(0) }))
    .default([]),
  activeQuestTarget: z.string().nullable().default(null),
  convoyId: z.string().optional(),
  worldX: z.number().nullable().default(null),
  worldY: z.number().nullable().default(null),
  hostile: z.boolean().default(false),
  sizeTier: z.enum(["small", "medium", "large", "boss"]).optional(),
});

export const NewsEventSchema = z.object({
  type: z.enum([
    "NPC_QUEST_COMPLETE",
    "PIRATE_ATTACK",
    "MARKET_SHIFT",
    "OVERMIND_EXPANSION",
    "PIRATE_SURGE",
    "TRADE_BOOM",
    "PLAGUE",
    "DISCOVERY",
    "SYSTEM_LIBERATED",
    "SYSTEM_CAPTURED",
    "LIBERATION_CAMPAIGN",
    "TRADE_OPPORTUNITY",
    "CAMPAIGN_ESCALATION",
  ]),
  npcId: z.string().optional(),
  systemId: z.string(),
  day: z.number().int().min(0),
  description: z.string().default(""),
  targetSystemId: z.string().optional(),
  stagingSystemId: z.string().optional(),
  liberationDate: z.number().int().min(0).optional(),
  resource: z.string().optional(),
  fromSystemId: z.string().optional(),
  toSystemId: z.string().optional(),
  marginPct: z.number().optional(),
});

export const ResourceTypeSchema = z.enum([
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
]);

export const RouteRumorSchema = z.object({
  id: z.string(),
  resource: ResourceTypeSchema,
  fromSystemId: z.string(),
  fromPlanetId: z.string(),
  toSystemId: z.string(),
  toPlanetId: z.string(),
  fromPrice: z.number(),
  toPrice: z.number(),
  marginPct: z.number(),
  createdDay: z.number().int().min(0),
  lastMarginPct: z.number(),
});

export const SpaceLootItemSchema = z.object({
  id: z.string(),
  moduleId: z.string().optional(),
  artifactId: z.string().optional(),
  x: z.number(),
  y: z.number(),
  spawnedAt: z.number(),
});

export const OvermindStatusSchema = z.enum([
  "dormant",
  "advancing",
  "contained",
  "won",
  "lost",
]);

export const OvermindSpreadStateSchema = z.object({
  dayZero: z.number(),
  lastSpreadDay: z.number(),
  status: OvermindStatusSchema,
  threat: z.number().min(0).max(1),
  peakThreat: z.number().min(0).max(1),
  playerLiberations: z.number().int().min(0).optional(),
});

const DORMANT_OVERMIND_ARC = {
  dayZero: -1,
  lastSpreadDay: -1,
  status: "dormant" as const,
  threat: 0,
  peakThreat: 0,
};

export const GalaxySchema = z.object({
  id: z.string(),
  gameDays: z.number().int().min(0),
  systems: z.array(StarSystemSchema).min(1).max(100),
  npcShips: z.array(NpcShipSchema).default([]),
  newsFeed: z.array(NewsEventSchema).default([]),
  questBoards: z.record(z.number().int().min(0)).default({}),
  overmindSystems: z.array(z.string()).default([]),
  pirateSystems: z.array(z.string()).default([]),
  overmindCoreSystemId: z.string().default(""),
  overmindArc: OvermindSpreadStateSchema.default(DORMANT_OVERMIND_ARC),
  activeTradeBoomSystems: z.record(z.number().int().min(0)).default({}),
  activeRumors: z.array(RouteRumorSchema).default([]),
  soldOutGear: z.record(z.number().int().min(0)).optional(),
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

export const ShipLoadoutSnapshotSchema = z.object({
  hullId: z.string(),
  hullMicromoduleIds: z.array(z.string()).optional(),
  hullMicromoduleId: z.string().optional(),
  slotted: z.array(
    z.object({
      gearId: z.string(),
      micromoduleId: z.string().optional(),
      upgrades: z.number().int().min(0).max(2).default(0),
    }),
  ),
});

export const LoadoutPresetSchema = z.object({
  name: z.enum(["1", "2", "3"]),
  slots: z.array(
    z.object({
      gearId: z.string(),
      micromoduleId: z.string().optional(),
      upgrades: z.number().optional(),
    }),
  ),
  hullMicromoduleIds: z.array(z.string()).optional(),
});

export const LedgerAccountTypeSchema = z.enum([
  "CURRENT",
  "SAVINGS",
  "LOAN",
  "GL_INTERNAL",
]);

export const LedgerAccountSchema = z.object({
  id: z.string(),
  type: LedgerAccountTypeSchema,
  label: z.string(),
  ownerId: z.string().optional(),
});

export const LedgerPostingSchema = z.object({
  accountId: z.string(),
  amount: z.number(),
  valueDate: z.number(),
});

export const LedgerJournalEntrySchema = z.object({
  id: z.string(),
  date: z.number(),
  reason: z.string(),
  postings: z.array(LedgerPostingSchema),
});

export const LoanDefaultSnapshotSchema = z.object({
  loanAccountId: z.string(),
  missedPayments: z.number(),
  penaltyActive: z.boolean(),
  defaulted: z.boolean(),
  nextDueDate: z.number(),
  owedAtLastDue: z.number(),
});

export const BankingSnapshotSchema = z.object({
  businessDate: z.number(),
  lastEodDate: z.number().nullable(),
  seq: z.number(),
  ledger: z.object({
    accounts: z.array(LedgerAccountSchema),
    entries: z.array(LedgerJournalEntrySchema),
  }),
  loanDefaults: z.array(LoanDefaultSnapshotSchema).optional(),
});

export const SaveStateSchema = z.object({
  version: z.number().int().positive(),
  timestamp: z.number().int(),
  galaxy: GalaxySchema,
  player: PlayerSchema,
  persistentDialogs: z.array(DialogueSessionSchema),
  currentSceneType: z.string().optional(),
  loadout: ShipLoadoutSnapshotSchema.optional(),
  banking: BankingSnapshotSchema.optional(),
  flightShipPos: z
    .object({ x: z.number(), y: z.number(), systemId: z.string() })
    .optional(),
  campaignPeakPower: z.number().min(0).max(1).optional(),
  loadoutPresets: z.array(LoadoutPresetSchema).max(3).optional(),
  autopilotEngaged: z.boolean().optional(),
});

export function validateSaveState(
  data: unknown,
): z.infer<typeof SaveStateSchema> {
  return SaveStateSchema.parse(data);
}
