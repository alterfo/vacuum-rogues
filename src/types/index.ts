export enum StarType {
  RED_DWARF = 'RED_DWARF',
  YELLOW_DWARF = 'YELLOW_DWARF',
  BLUE_GIANT = 'BLUE_GIANT',
  WHITE_DWARF = 'WHITE_DWARF',
  NEUTRON = 'NEUTRON',
  BLACK_HOLE = 'BLACK_HOLE',
}

export enum PlanetType {
  TERRESTRIAL = 'TERRESTRIAL',
  GAS_GIANT = 'GAS_GIANT',
  ICE = 'ICE',
  VOLCANIC = 'VOLCANIC',
  INDUSTRIAL = 'INDUSTRIAL',
  HABITAT = 'HABITAT',
}

export enum RaceType {
  HUMAN = 'HUMAN',
  MALAQAR = 'MALAQAR',
  PELENG = 'PELENG',
  FAERIAN = 'FAERIAN',
  GAALIAN = 'GAALIAN',
}

export enum EnemyType {
  SCOUT = 'SCOUT',
  FIGHTER = 'FIGHTER',
  CRUISER = 'CRUISER',
  DREADNOUGHT = 'DREADNOUGHT',
  POSSESSED = 'POSSESSED',
}

export enum ModuleCategory {
  WEAPON = 'WEAPON',
  SHIELD = 'SHIELD',
  ENGINE = 'ENGINE',
}

export enum TileType {
  EMPTY = 'EMPTY',
  ASTEROID = 'ASTEROID',
  DEBRIS = 'DEBRIS',
  NEBULA = 'NEBULA',
}

export enum QuestType {
  DELIVERY = 'DELIVERY',
  BOUNTY = 'BOUNTY',
  ESCORT = 'ESCORT',
  DIPLOMACY = 'DIPLOMACY',
  EXPLORATION = 'EXPLORATION',
}

export enum EventType {
  CHAOS_GATE = 'CHAOS_GATE',
  INVASION = 'INVASION',
  TRADER = 'TRADER',
}

export enum ResourceType {
  FUEL = 'FUEL',
  METALS = 'METALS',
  CRYSTALS = 'CRYSTALS',
  ORGANICS = 'ORGANICS',
  ARTIFACTS = 'ARTIFACTS',
  WEAPONS = 'WEAPONS',
  MEDICINE = 'MEDICINE',
  ELECTRONICS = 'ELECTRONICS',
  LUXURY = 'LUXURY',
  DATA_CORES = 'DATA_CORES',
}

export enum EncounterState {
  IN_PROGRESS = 'IN_PROGRESS',
  PLAYER_WON = 'PLAYER_WON',
  PLAYER_LOST = 'PLAYER_LOST',
  RETREAT = 'RETREAT',
}

export enum SceneType {
  MAIN_MENU = 'MAIN_MENU',
  STAR_MAP = 'STAR_MAP',
  COMBAT = 'COMBAT',
  DIALOGUE = 'DIALOGUE',
  INVENTORY = 'INVENTORY',
  SPACE_FLIGHT = 'SPACE_FLIGHT',
}

export enum ProfileLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum ErrorSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
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
  readonly type: 'MOVE' | 'ATTACK' | 'ABILITY' | 'WAIT';
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
  readonly xp: number;
  readonly items: unknown[];
  readonly reputationDelta: number;
}

export interface QuestObjective {
  readonly id: string;
  readonly description: string;
  readonly targetAmount: number;
  readonly currentAmount: number;
  readonly completed: boolean;
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
  readonly type: 'INVADE' | 'FORTIFY' | 'SPAWN_GATE';
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
