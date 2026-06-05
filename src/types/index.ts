import { Faction } from "./faction";

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
}

export enum EventType {
  CHAOS_GATE = "CHAOS_GATE",
  INVASION = "INVASION",
  TRADER = "TRADER",
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
}

export enum StationType {
  TRADE_POST = "TRADE_POST",
  REPAIR_DOCK = "REPAIR_DOCK",
  MILITARY_BASE = "MILITARY_BASE",
  RESEARCH_LAB = "RESEARCH_LAB",
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
}

export interface CombatResult {
  readonly success: boolean;
  readonly damageDealt?: number;
  readonly damageTaken?: number;
  readonly xpGained?: number;
  readonly loot?: unknown[];
  readonly message: string;
}

export interface EncounterResult {
  readonly outcome: EncounterState;
  readonly xpGained: number;
  readonly loot: unknown[];
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
  readonly type: "COLLECT_ITEM" | "VISIT_LOCATION" | "DEFEAT_ENEMY"; // Added objective type
  readonly targetAmount: number;
  readonly currentAmount: number;
  readonly completed: boolean;
  readonly itemType?: ResourceType; // For COLLECT_ITEM objectives
  readonly locationId?: string; // For VISIT_LOCATION objectives
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
  readonly activeQuests: unknown[];
  readonly completedQuests: unknown[];
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
