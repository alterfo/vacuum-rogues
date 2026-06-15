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
  // Branching text-adventure novella (EPIC-005), issued ~1 in 5 by the quest
  // generator (EPIC-008) as the special "cherry on top".
  TEXT_ADVENTURE = "TEXT_ADVENTURE",
  // Anti-OVERMIND defense mission: fly to the target system to push OVERMIND back.
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
  COMBAT = "COMBAT",
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

// --- Living Galaxy: autonomous NPC ships (Feature 8) ---

export enum NpcRole {
  RANGER = "RANGER",
  TRADER = "TRADER",
  PIRATE = "PIRATE",
  PATROL = "PATROL",
}

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

/** Plain initialization data for an NpcShip (also its serialized shape). */
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
  /** Shield tech level — compared against player scanPower for scan check. */
  shieldPower?: number;
  /** Names of equipment items visible when scanned (3 items at NPC tech level). */
  loadoutSummary?: string[];
  /** Goods a trader NPC is currently carrying between systems. */
  cargo?: { goodId: string; qty: number }[];
  /** System ID this ranger NPC is currently traveling toward to complete a quest. */
  activeQuestTarget?: string | null;
  /** Shared ID grouping ships travelling together as a military convoy. */
  convoyId?: string;
  /** True when openly hostile to the player (garrison/pirate spawns, or attacked). */
  hostile?: boolean;
}

/** A simulation event emitted by the living-galaxy and collected in newsFeed. */
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
    | "LIBERATION_CAMPAIGN";
  /** Ranger NPC that completed a quest (NPC_QUEST_COMPLETE only). */
  npcId?: string;
  /** System where the event occurred. */
  systemId: string;
  /** Galaxy day the event was emitted. */
  day: number;
  /** Human-readable description shown in the news feed. */
  description: string;
  /** Hostile system a liberation campaign targets (LIBERATION_CAMPAIGN only). */
  targetSystemId?: string;
  /** Friendly system rangers rally at before the assault (LIBERATION_CAMPAIGN only). */
  stagingSystemId?: string;
  /** Absolute galaxy day the rally departs / assault begins (LIBERATION_CAMPAIGN only). */
  liberationDate?: number;
}

/**
 * A floating loot item dropped by a destroyed NPC ship in the player's flight
 * scene (Feature: space loot drops). Transient/presentation-only — lives in the
 * NpcShipManager's in-memory `spaceLoot` array, never persisted in SaveState.
 * Carries either a `moduleId` (salvaged equipment) or an `artifactId` (Overmind
 * artifact); `x`/`y` are world-space and `spawnedAt` is the manager's elapsed-ms
 * clock at spawn (used to despawn the item after its lifetime).
 */
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
  // chainId → completed part indices (0/1/2); persisted for cross-session chains.
  readonly completedChainParts?: Record<string, number[]>;
  // Quests whose objectives are done but reward is unclaimed (return-to-issuer).
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

/**
 * Serialized snapshot of the canonical GearCatalog loadout (hull + slotted
 * gear + micromodules). Produced by ShipLoadout.toJSON(), restored by
 * ShipLoadout.fromJSON() on load — without it, gear bought in the equipment
 * shop silently vanished on "Continue" (letsplay F6 follow-up).
 */
export interface ShipLoadoutSnapshot {
  readonly hullId: string;
  readonly hullMicromoduleId?: string;
  readonly slotted: {
    readonly gearId: string;
    micromoduleId?: string;
    upgrades?: number;
  }[];
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

// --- Text Quest Graph (EPIC-005) ---

export interface QuestCondition {
  readonly type: "credits" | "reputation" | "item";
  /** The comparison operator applied to player's value vs. this value. */
  readonly comparison: ">=" | "<=" | "==" | ">";
  readonly value: number;
  /** For reputation checks: which faction id to look up. */
  readonly factionId?: string;
  /** For item checks: which resource type (ResourceType string) must be in inventory. */
  readonly itemId?: string;
}

export interface QuestOutcome {
  readonly creditsDelta: number;
  readonly reputationDelta: number;
  /** Faction that receives the reputation delta (required when reputationDelta ≠ 0). */
  readonly factionId?: string;
  /** ResourceType string added to player inventory (quantity = 1). */
  readonly itemGained?: string;
  /** ResourceType string removed from player inventory (quantity = 1). */
  readonly itemLost?: string;
  /** Short text appended to the player journal when this outcome fires. */
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
  /** Lookup key for narration text (used by QuestNarrator / TemplateQuestNarrator). */
  readonly textKey: string;
  readonly choices: QuestChoice[];
}

export interface TextQuest {
  readonly id: string;
  readonly title: string;
  readonly nodes: QuestNode[];
  readonly startNodeId: string;
}

/** Saved runtime state of an in-progress text quest. */
export interface TextQuestState {
  readonly questId: string;
  readonly currentNodeId: string;
  /** Outcomes accumulated so far (applied only on quest completion). */
  readonly pendingOutcomes: QuestOutcome[];
}
