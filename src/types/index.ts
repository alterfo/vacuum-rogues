import { Faction } from "./faction";
import type { Quest } from "@/domain/Quest";

export enum StarType {
  RED_DWARF = "RED_DWARF",
  YELLOW_DWARF = "YELLOW_DWARF",
  BLUE_GIANT = "BLUE_GIANT",
  WHITE_DWARF = "WHITE_DWARF",
  NEUTRON = "NEUTRON",
  BLACK_HOLE = "BLACK_HOLE",
}

export enum PlanetType {
  TERRESTRIAL = "TERRESTRIAL",
  GAS_GIANT = "GAS_GIANT",
  ICE = "ICE",
  VOLCANIC = "VOLCANIC",
  INDUSTRIAL = "INDUSTRIAL",
  HABITAT = "HABITAT",
}

export enum FactionType {
  OUTLANDERS = "OUTLANDERS",
  BASTIONS = "BASTIONS",
  SYNDICATE = "SYNDICATE",
  PARADOXES = "PARADOXES",
  PROGRESSORS = "PROGRESSORS",
}

export type GameMode = "GOD" | "NORMAL" | "HARD";

export enum EnemyType {
  SCOUT = "SCOUT",
  FIGHTER = "FIGHTER",
  CRUISER = "CRUISER",
  DREADNOUGHT = "DREADNOUGHT",
  POSSESSED = "POSSESSED",
}

export enum ModuleCategory {
  WEAPON = "WEAPON",
  SHIELD = "SHIELD",
  ENGINE = "ENGINE",
  EQUIPMENT = "EQUIPMENT",
  HULL = "HULL",
}

export interface MicroModule {
  readonly id: string;
  readonly name: string;
  readonly targetCategory: ModuleCategory;
  readonly bonusType: string;
  readonly bonusTier: 1 | 2 | 3;
}

export enum TileType {
  EMPTY = "EMPTY",
  ASTEROID = "ASTEROID",
  DEBRIS = "DEBRIS",
  NEBULA = "NEBULA",
}

export enum QuestType {
  DELIVERY = "DELIVERY",
  BOUNTY = "BOUNTY",
  ESCORT = "ESCORT",
  DIPLOMACY = "DIPLOMACY",
  EXPLORATION = "EXPLORATION",
  TEXT_ADVENTURE = "TEXT_ADVENTURE",
  DEFENSE = "DEFENSE",
}

export enum EventType {
  CHAOS_GATE = "CHAOS_GATE",
  INVASION = "INVASION",
  TRADER = "TRADER",
}

export enum GalaxyEventType {
  PIRATE_SURGE = "PIRATE_SURGE",
  TRADE_BOOM = "TRADE_BOOM",
  PLAGUE = "PLAGUE",
  DISCOVERY = "DISCOVERY",
}

export interface GalaxyGlobalEvent {
  type: GalaxyEventType;
  systemId: string;
  severity: 1 | 2 | 3;
  day: number;
}

export enum ResourceType {
  FUEL = "FUEL",
  METALS = "METALS",
  CRYSTALS = "CRYSTALS",
  ORGANICS = "ORGANICS",
  ARTIFACTS = "ARTIFACTS",
  WEAPONS = "WEAPONS",
  MEDICINE = "MEDICINE",
  ELECTRONICS = "ELECTRONICS",
  LUXURY = "LUXURY",
  DATA_CORES = "DATA_CORES",
}

export enum EncounterState {
  IN_PROGRESS = "IN_PROGRESS",
  PLAYER_WON = "PLAYER_WON",
  PLAYER_LOST = "PLAYER_LOST",
  RETREAT = "RETREAT",
}

export enum WeaponAbility {
  NONE = "NONE",
  EMP = "EMP",
  HOMING = "HOMING",
  BURST = "BURST",
}

export enum SceneType {
  MAIN_MENU = "MAIN_MENU",
  RACE_SELECTION = "RACE_SELECTION",
  STAR_MAP = "STAR_MAP",
  DIALOGUE = "DIALOGUE",
  INVENTORY = "INVENTORY",
  SPACE_FLIGHT = "SPACE_FLIGHT",
  PLANET = "PLANET",
  TRADE = "TRADE",
  EQUIPMENT_SHOP = "EQUIPMENT_SHOP",
  INFO_CENTER = "INFO_CENTER",
  STATION = "STATION",
  GOVERNMENT = "GOVERNMENT",
  TEXT_QUEST = "TEXT_QUEST",
  WIN_SCREEN = "WIN_SCREEN",
  GAME_OVER = "GAME_OVER",
  BANK = "BANK",
  SAVE_LOAD = "SAVE_LOAD",
  BLACK_HOLE_ARCADE = "BLACK_HOLE_ARCADE",
}

export enum StationType {
  TRADE_POST = "TRADE_POST",
  REPAIR_DOCK = "REPAIR_DOCK",
  MILITARY_BASE = "MILITARY_BASE",
  RESEARCH_LAB = "RESEARCH_LAB",
  CRAFT_CENTER = "CRAFT_CENTER",
}

export enum ProfileLevel {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
}

export enum NpcRole {
  RANGER = "RANGER",
  TRADER = "TRADER",
  PIRATE = "PIRATE",
  PATROL = "PATROL",
  OVERMIND = "OVERMIND",
}

export type NpcSizeTier = "small" | "medium" | "large" | "boss";

export enum NpcState {
  IDLE = "IDLE",
  TRAVELING = "TRAVELING",
  TRADING = "TRADING",
  QUESTING = "QUESTING",
  PATROLLING = "PATROLLING",
  FIGHTING = "FIGHTING",
  DEAD = "DEAD",
}

export enum NpcGoalKind {
  TRAVEL = "TRAVEL",
  TRADE = "TRADE",
  QUEST = "QUEST",
  PATROL = "PATROL",
  HUNT = "HUNT",
}

export interface NpcGoal {
  readonly kind: NpcGoalKind;
  readonly targetSystemId?: string;
  readonly questId?: string;
}

export interface NpcShipInit {
  id: string;
  name: string;
  race: FactionType;
  faction: Faction;
  role: NpcRole;
  hullHP: number;
  maxHull: number;
  shields: number;
  speed: number;
  damage: number;
  currentSystemId: string;
  state: NpcState;
  goal: NpcGoal | null;
  destinationSystemId: string | null;
  daysToArrival: number;
  credits: number;
  reputation: number;
  shieldPower?: number;
  loadoutSummary?: string[];
  cargo?: { goodId: string; qty: number }[];
  activeQuestTarget?: string | null;
  convoyId?: string;
  worldX?: number | null;
  worldY?: number | null;
  hostile?: boolean;
  sizeTier?: NpcSizeTier;
}

export interface NewsEvent {
  type:
    | "NPC_QUEST_COMPLETE"
    | "PIRATE_ATTACK"
    | "MARKET_SHIFT"
    | "OVERMIND_EXPANSION"
    | "PIRATE_SURGE"
    | "TRADE_BOOM"
    | "PLAGUE"
    | "DISCOVERY"
    | "SYSTEM_LIBERATED"
    | "SYSTEM_CAPTURED"
    | "LIBERATION_CAMPAIGN"
    | "TRADE_OPPORTUNITY"
    | "CAMPAIGN_ESCALATION";
  npcId?: string;
  systemId: string;
  day: number;
  description: string;
  targetSystemId?: string;
  stagingSystemId?: string;
  liberationDate?: number;
  resource?: ResourceType;
  fromSystemId?: string;
  toSystemId?: string;
  marginPct?: number;
}

export interface SpaceLootItem {
  id: string;
  moduleId?: string;
  artifactId?: string;
  x: number;
  y: number;
  spawnedAt: number;
}

export enum EconomyType {
  AGRICULTURAL = "AGRICULTURAL",
  INDUSTRIAL = "INDUSTRIAL",
  MIXED = "MIXED",
}

export enum PoliticalSystem {
  ANARCHY = "ANARCHY",
  DICTATORSHIP = "DICTATORSHIP",
  MONARCHY = "MONARCHY",
  REPUBLIC = "REPUBLIC",
  DEMOCRACY = "DEMOCRACY",
}

export enum ErrorSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL",
}

export enum HullClass {
  LIGHT_FIGHTER = "LIGHT_FIGHTER",
  CORVETTE = "CORVETTE",
  FRIGATE = "FRIGATE",
  DESTROYER = "DESTROYER",
  TRANSPORT = "TRANSPORT",
  HEAVY_FREIGHTER = "HEAVY_FREIGHTER",
  CRUISER = "CRUISER",
}

export interface HullClassSpec {
  readonly maxHp: number;
  readonly weaponSlots: number;
  readonly equipmentSlots: number;
  readonly cargoCapacity: number;
  readonly techLevel: number;
}

export const HULL_CLASS_SPECS: Record<HullClass, HullClassSpec> = {
  [HullClass.LIGHT_FIGHTER]: {
    maxHp: 90,
    weaponSlots: 2,
    equipmentSlots: 2,
    cargoCapacity: 20,
    techLevel: 2,
  },
  [HullClass.CORVETTE]: {
    maxHp: 140,
    weaponSlots: 2,
    equipmentSlots: 3,
    cargoCapacity: 30,
    techLevel: 3,
  },
  [HullClass.TRANSPORT]: {
    maxHp: 120,
    weaponSlots: 1,
    equipmentSlots: 4,
    cargoCapacity: 45,
    techLevel: 3,
  },
  [HullClass.FRIGATE]: {
    maxHp: 220,
    weaponSlots: 3,
    equipmentSlots: 4,
    cargoCapacity: 35,
    techLevel: 5,
  },
  [HullClass.HEAVY_FREIGHTER]: {
    maxHp: 180,
    weaponSlots: 2,
    equipmentSlots: 4,
    cargoCapacity: 120,
    techLevel: 4,
  },
  [HullClass.DESTROYER]: {
    maxHp: 360,
    weaponSlots: 4,
    equipmentSlots: 5,
    cargoCapacity: 50,
    techLevel: 7,
  },
  [HullClass.CRUISER]: {
    maxHp: 280,
    weaponSlots: 3,
    equipmentSlots: 5,
    cargoCapacity: 45,
    techLevel: 6,
  },
};

export interface AxialCoord {
  readonly q: number;
  readonly r: number;
}

export interface SkillBonus {
  readonly piloting?: number;
  readonly tactics?: number;
  readonly trading?: number;
  readonly diplomacy?: number;
  readonly hacking?: number;
}

export interface UniqueMechanic {
  readonly id: string;
  readonly description: string;
}

export interface DialogueStyle {
  readonly tone: string;
  readonly formality: number;
  readonly verbosity: number;
}

export interface ShipBaseline {
  readonly hullHP: number;
  readonly shields: number;
  readonly energy: number;
  readonly speed: number;
  readonly evasion: number;
}

export interface TradeModifier {
  readonly buyMultiplier: number;
  readonly sellMultiplier: number;
}

export interface ModuleEffect {
  readonly type: string;
  readonly value: number;
}

export interface CombatAction {
  readonly type: "MOVE" | "ATTACK" | "ABILITY" | "WAIT";
  readonly target?: AxialCoord;
  readonly abilityId?: string;
  readonly weaponId?: string;
}

export interface CombatResult {
  readonly success: boolean;
  readonly damageDealt?: number;
  readonly damageTaken?: number;
  readonly xpGained?: number;
  readonly killPointsGained?: number;
  readonly loot?: unknown[];
  readonly items?: { type: ResourceType; amount: number }[];
  readonly message: string;
  readonly outcome?: EncounterState;
}

export interface EncounterResult {
  readonly outcome: EncounterState;
  readonly xpGained: number;
  readonly killPointsGained: number;
  readonly loot: unknown[];
  readonly items?: { type: ResourceType; amount: number }[];
  readonly message: string;
}

export interface DialogueOption {
  readonly id: string;
  readonly text: string;
  readonly tags: string[];
  readonly requiredEmotion?: Partial<EmotionVectorData>;
}

export interface NPCResponse {
  readonly text: string;
  readonly emotionIndicators: EmotionVectorData;
  readonly options: DialogueOption[];
  readonly reputationDelta: number;
}

export interface EmotionVectorData {
  readonly trust: number;
  readonly fear: number;
  readonly respect: number;
  readonly hostility: number;
  readonly curiosity: number;
}

export interface Reward {
  readonly credits: number;
  readonly experience: number; // Changed from xp for consistency
  readonly items: { type: ResourceType; amount: number }[]; // Changed from unknown[]
  readonly reputationDelta?: number; // Made optional for simple quests
}

export interface QuestObjective {
  readonly id: string;
  readonly description: string;
  readonly type:
    | "COLLECT_ITEM"
    | "VISIT_LOCATION"
    | "VISIT_SYSTEM"
    | "DEFEAT_ENEMY";
  readonly targetAmount: number;
  readonly currentAmount: number;
  readonly completed: boolean;
  readonly itemType?: ResourceType; // For COLLECT_ITEM objectives
  readonly locationId?: string; // For VISIT_LOCATION objectives
  readonly targetSystemId?: string; // For VISIT_SYSTEM objectives
  readonly enemyType?: EnemyType; // For DEFEAT_ENEMY objectives
}

export interface DialogueAnchor {
  readonly id: string;
  readonly template: string;
  readonly nextAnchors: string[];
  readonly conditions: string[];
}

export interface NPCCharacter {
  readonly traits: string[];
  readonly backstory: string;
}

export interface ReputationMap {
  readonly [factionId: string]: number;
}

export interface QuestLog {
  readonly activeQuests: Quest[];
  readonly completedQuests: string[];
  readonly completedChainParts?: Record<string, number[]>;
  readonly pendingReturnQuests?: Quest[];
}

export interface Journal {
  readonly entries: JournalEntry[];
}

export interface JournalEntry {
  readonly id: string;
  readonly date: number;
  readonly text: string;
}

export interface TerrainConfig {
  readonly obstacles: AxialCoord[];
  readonly cover: AxialCoord[];
  readonly nebulae: AxialCoord[];
}

export interface TransactionResult {
  readonly success: boolean;
  readonly finalPrice: number;
  readonly remainingBalance: number;
  readonly message: string;
}

export interface OvermindAction {
  readonly type: "INVADE" | "FORTIFY" | "SPAWN_GATE";
  readonly targetSystemId: string;
}

export type OvermindStatus =
  | "dormant"
  | "advancing"
  | "contained"
  | "won"
  | "lost";

export interface OvermindSpreadState {
  dayZero: number;
  lastSpreadDay: number;
  status: OvermindStatus;
  threat: number;
  peakThreat: number;
  playerLiberations?: number;
}

export interface ModelConfig {
  readonly modelId: string;
  readonly url: string;
  readonly version: string;
  readonly sizeBytes: number;
}

export interface CacheInfo {
  readonly cachedModels: string[];
  readonly totalSizeBytes: number;
}

export interface SaveSlotInfo {
  readonly slotId: string;
  readonly timestamp: number;
  readonly playerLevel: number;
  readonly location: string;
  readonly currentSceneType?: SceneType;
}

export interface ErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
}

export interface GameConfig {
  readonly seed?: string;
  readonly systemCount?: number;
  readonly overmindSpeed?: number;
}

export interface SerializedSave {
  readonly version: number;
  readonly timestamp: number;
  readonly payload: string;
}

export interface ShipLoadoutSnapshot {
  readonly hullId: string;
  readonly hullMicromoduleIds?: string[];
  readonly hullMicromoduleId?: string;
  readonly slotted: {
    readonly gearId: string;
    micromoduleId?: string;
    upgrades?: number;
  }[];
}

export type LoadoutPresetName = "1" | "2" | "3";

export interface LoadoutPreset {
  readonly name: LoadoutPresetName;
  readonly slots: ReadonlyArray<{
    readonly gearId: string;
    readonly micromoduleId?: string;
    readonly upgrades?: number;
  }>;
  readonly hullMicromoduleIds?: readonly string[];
}

export interface ResourceCost {
  readonly type: ResourceType;
  readonly amount: number;
}

export interface Ability {
  readonly id: string;
  readonly name: string;
  readonly cooldown: number;
  readonly currentCooldown: number;
}

export interface AIProfile {
  readonly aggressiveness: number;
  readonly caution: number;
  readonly targetPriority: string[];
}

export interface QuestCondition {
  readonly type: "credits" | "reputation" | "item";
  readonly comparison: ">=" | "<=" | "==" | ">";
  readonly value: number;
  readonly factionId?: string;
  readonly itemId?: string;
}

export interface QuestOutcome {
  readonly creditsDelta: number;
  readonly reputationDelta: number;
  readonly factionId?: string;
  readonly itemGained?: string;
  readonly itemLost?: string;
  readonly journalEntry: string;
}

export interface QuestChoice {
  readonly label: string;
  readonly conditions: QuestCondition[];
  readonly nextNodeId: string | null;
  readonly outcome: QuestOutcome | null;
}

export interface QuestNode {
  readonly id: string;
  readonly textKey: string;
  readonly choices: QuestChoice[];
}

export interface TextQuest {
  readonly id: string;
  readonly title: string;
  readonly nodes: QuestNode[];
  readonly startNodeId: string;
}

export interface TextQuestState {
  readonly questId: string;
  readonly currentNodeId: string;
  readonly pendingOutcomes: QuestOutcome[];
}
