# Entities, Module Architecture, and Development Approaches

> Reference document for «Вакуумные Пройдохи». Canonical entity definitions, module dependency diagrams, and process guidelines. Use this when designing new features, writing code reviews, or planning tasks.

---

## Part 1: Entity Catalogue

### Core Domain Entities

```
Galaxy
  id: string
  seed: number
  sectors: Sector[]
  gameDays: number

Sector
  id: string
  name: string
  systems: StarSystem[]

StarSystem
  id: string
  sectorId: string
  name: string
  seed: number
  star: Star
  planets: Planet[]
  stations: Station[]
  npcShips: NpcShip[]          ← live slice, not persisted here
  position: {x, y}             ← galaxy-map coordinates
  isExplored: boolean
  techLevel: number             ← 1–8; advances via advanceTech() in GalaxySimulator;
                                   RESEARCH_LAB systems gain +1 every 50 days,
                                   others every 100 days; Overmind/pirate systems stagnate

Star
  type: StarType                ← YELLOW | RED_GIANT | BLUE | WHITE_DWARF | PULSAR
  size: number
  color: number                 ← hex, derived from seed

Planet
  id: string
  systemId: string
  name: string
  type: PlanetType              ← ROCKY | GAS | ICE | DESERT | OCEAN | JUNGLE | …
  isHabitable: boolean
  factionId: FactionType | null
  politicalSystem: PoliticalSystem
  economyType: EconomyType      ← AGRARIAN | INDUSTRIAL | MIXED
  population: number
  market: Market
  questBoard: QuestBoard
  moons: Moon[]
  orbitRadius: number
  orbitAngle: number
  drones: number                ← for uninhabited planets

Moon
  planetId: string
  orbitRadius: number
  orbitAngle: number
  size: number

Station
  id: string
  systemId: string
  name: string
  type: StationType             ← CRAFT_STATION | RESEARCH_BASE | MILITARY_BASE |
                                   PIRATE_BASE | MEDICAL_STATION | TRADE_HUB
  factionId: FactionType
  position: {x, y}             ← system coordinates
  market: Market
  services: StationService[]

Market
  ownerId: string               ← planetId or stationId
  goods: GoodEntry[]

GoodEntry
  itemId: string
  quantity: number
  buyPrice: number
  sellPrice: number
  isLegal: boolean

QuestBoard
  ownerId: string
  quests: Quest[]

Quest
  id: string
  type: QuestType               ← DELIVERY | BOUNTY | ESCORT | EXPLORATION | DIPLOMACY
  title: string
  description: string
  giverId: string               ← planetId / stationId
  targetId: string              ← destination planet/NPC
  reward: QuestReward
  deadline: number              ← game days from acceptance
  status: QuestStatus           ← AVAILABLE | ACTIVE | PENDING_RETURN | COMPLETED | FAILED
  isPendingReturn: boolean      ← objectives done, reward unclaimed (return-to-issuer)
  factionId: FactionType

  Note: BOUNTY/ESCORT/EXPLORATION/DEFENSE enter PENDING_RETURN once objectives
  are satisfied and require the player to land at the issuer planet (giverId) to
  claim the reward. DELIVERY/DIPLOMACY/TEXT_ADVENTURE complete at the target.

QuestReward
  credits: number
  items: ItemStack[]
  reputationDelta: Record<FactionType, number>

Player
  id: string
  name: string
  factionId: FactionType        ← chosen faction at start
  ship: Ship
  credits: number
  reputation: Record<FactionType, number>
  questLog: QuestLog
  rank: Rank
  rankPoints: number
  currentSystemId: string
  visitedSystemIds: Set<string>
  gameDay: number

Ship
  hullId: string
  hullType: HullType            ← T1..T8
  hp: number
  maxHp: number
  slots: EquipmentSlot[]
  cargo: ItemStack[]
  fuelCurrent: number
  fuelMax: number               ← derived from FUEL_TANK equipment

EquipmentSlot
  slotType: SlotType
  isOpen: boolean
  equipment: Equipment | null

Equipment
  id: string
  category: EquipmentCategory   ← ENGINE | FUEL_TANK | RADAR | SCANNER | REPAIR_DROID |
                                   GRABBER | SHIELD_GEN | WEAPON | HULL
  techLevel: number             ← 1..8; may be boosted above base by artifact upgrades
  factionId: FactionType
  size: number
  quality: number
  stats: Record<string, number>
  micromoduleId: string | null
  upgrades?: number             ← 0–2; each upgrade costs artifacts and raises techLevel+1;
                                   applied at RESEARCH_LAB via ResearchUpgradePanel

Weapon (extends Equipment)
  weaponType: WeaponType        ← ENERGY | KINETIC | MISSILE
  damage: number
  range: number
  accuracy: number

QuestLog
  active: Quest[]
  pendingReturn: Quest[]        ← objectives done, awaiting return-to-issuer claim
  completed: Quest[]            ← IDs + summary stored

NpcShip
  id: string
  name: string
  factionId: FactionType
  shipClass: NpcShipClass       ← TRADER | PATROL | PIRATE | ESCORT | RANGER_NPC
  brain: NpcBrain
  ship: Ship                    ← same structure as player ship
  currentSystemId: string
  targetSystemId: string | null
  reputation: Record<FactionType, number>
  convoyId?: string             ← shared ID for PATROL ships traveling in formation;
                                   set by assembleConvoy() every 30 days; ships with the
                                   same convoyId render in V-formation (±30 px offset)

NpcBrain
  state: NpcState               ← IDLE | TRAVELING | TRADING | PATROLLING | ATTACKING | FLEEING
  route: SystemId[]
  aggressionLevel: number

TextQuestNode
  id: string
  text: string                  ← generated or static
  choices: TextQuestChoice[]

TextQuestChoice
  label: string
  nextNodeId: string | null
  outcome: QuestOutcome

CombatState
  attacker: Player | NpcShip
  defender: Player | NpcShip
  round: number
  log: CombatLogEntry[]
  status: CombatStatus          ← ONGOING | PLAYER_WIN | PLAYER_FLEE | PLAYER_DEAD
```

---

## Part 2: Entity Relationship Diagram

```
                        ┌──────────────────────────────────────────┐
                        │                  Galaxy                   │
                        │  seed · gameDays                          │
                        └────────────────┬─────────────────────────┘
                                         │ 1..*
                        ┌────────────────▼─────────────────────────┐
                        │                 Sector                    │
                        └────────────────┬─────────────────────────┘
                                         │ 1..*
         ┌───────────────────────────────▼───────────────────────────────┐
         │                         StarSystem                             │
         │  name · seed · position(x,y) · isExplored                     │
         └──┬──────────────┬─────────────────────────┬───────────────────┘
            │ 1            │ 1..*                     │ 0..*
         ┌──▼──┐      ┌────▼─────────────┐    ┌──────▼────────┐
         │Star │      │     Planet        │    │   Station     │
         │type │      │ type·faction      │    │ type·faction  │
         │size │      │ economy·politics  │    │ services[]    │
         └─────┘      │ population        │    └───────┬───────┘
                      └──┬─────────┬──────┘            │
                         │ 0..*    │ 1                  │ 1
                      ┌──▼──┐  ┌──▼──────┐        ┌────▼────┐
                      │Moon │  │ Market  │        │ Market  │
                      │orbit│  │goods[]  │        │goods[]  │
                      └─────┘  └─────────┘        └─────────┘
                               ┌──────────┐
                               │QuestBoard│
                               │quests[]  │
                               └──────────┘

┌───────────────────────────────────────────────────────────────┐
│                           Player                              │
│  credits · reputation{FactionType→int} · rank · gameDay      │
│  currentSystemId · visitedSystemIds                           │
└──────┬───────────────────────────────┬────────────────────────┘
       │ 1                             │ 1
    ┌──▼────────────────┐      ┌───────▼────────────┐
    │       Ship        │      │     QuestLog        │
    │ hull · hp · cargo │      │ active[]            │
    │ fuel · slots[]    │      │ completed[]         │
    └──────┬────────────┘      └────────────────────┘
           │ 1..*
    ┌──────▼────────────┐
    │  EquipmentSlot    │──── Equipment (Engine/Radar/Weapon/…)
    │  slotType·isOpen  │         │ 0..1
    └───────────────────┘   MicroModule (MM1..3)

┌─────────────────────────────────────────────────────────────┐
│                         NpcShip                             │
│  factionId · shipClass · brain                              │
│  currentSystemId · targetSystemId                           │
└──────────────────────────────────────────────────────────────┘
   same Ship structure as Player.ship (shared type)

┌─────────────────────────────────────────────────────────────┐
│                        Quest                                │
│  type · title · giverId · targetId · deadline               │
│  reward{credits,items,repDelta}                             │
└──────────────────────────────────────────────────────────────┘
   Quest is owned by QuestBoard (before acceptance)
   Quest is owned by QuestLog (after acceptance)

┌─────────────────────────────────────────────────────────────┐
│                      CombatState                            │
│  attacker · defender · round · status                       │
└──────────────────────────────────────────────────────────────┘
   Transient — not persisted. Created by CombatSystem.
```

---

## Part 3: Module Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       PRESENTATION LAYER                        │
│  (PixiJS scenes; zero game-logic; read domain / emit events)    │
│                                                                  │
│  MainMenuScene      RaceSelectionScene    StarMapScene           │
│  SpaceFlightScene   PlanetScene           StationScene           │
│  TradeScene         EquipmentShopScene    InventoryScene         │
│  CombatScene        DialogueScene         TextQuestScene         │
│  GovernmentScene    InfoCenterScene       QuestJournalUI         │
│  HUD                SystemMiniMap         NpcContactPanel        │
│  PlanetInfoPanel    PlanetSprite          [WinScreen]            │
└────────────────────────────┬────────────────────────────────────┘
                             │ commands / events
┌────────────────────────────▼────────────────────────────────────┐
│                       ENGINE CORE                               │
│  GameEngine (scene transitions, game loop, save coordination)   │
│  SceneFactory   DIContainer   AudioManager                      │
│  SaveManager    MigrationPipeline                               │
└────┬──────┬──────────┬─────────────┬───────────────┬────────────┘
     │      │          │             │               │
 ┌───▼──┐ ┌─▼──────┐ ┌─▼──────────┐ ┌─▼──────────┐ ┌▼─────────────┐
 │Trade │ │Living  │ │  Quests    │ │  Combat    │ │  AI / ONNX   │
 │System│ │Galaxy  │ │QuestManager│ │CombatSystem│ │ONNXRegistry  │
 │Market│ │NpcSim. │ │QuestDirectr│ │Tactical    │ │FallbackEngine│
 │      │ │NpcBrain│ │            │ │Encounter   │ │Web Worker    │
 └───┬──┘ └─┬──────┘ └─┬──────────┘ └─┬──────────┘ └┬─────────────┘
     └───────┴──────────┴──────────────┘              │
                    │ read-only                        │
┌───────────────────▼──────────────────────────────────▼────────────┐
│                         DOMAIN LAYER                              │
│  (pure TypeScript; zero PixiJS / ONNX / DOM dependencies)        │
│                                                                   │
│  Player   Galaxy    StarSystem   Planet    Star    Moon           │
│  NpcShip  Quest     QuestLog     Market    Station Ship           │
│  Equipment Weapon   Faction      FactionRegistry                  │
└───────────────────────────────┬───────────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────────┐
│              PERSISTENCE + CONTRACTS                              │
│  SaveManager   MigrationPipeline   Zod schemas                   │
│  src/types/index.ts   src/config/balance.ts   src/validation/    │
└────────────────────────────────────────────────────────────────────┘

Orthogonal: AudioManager (hooks from engine), WebWorkers (ONNX inference only)
```

### Key Dependency Rules

1. **Presentation → Engine only** — scenes never import directly from Systems.
2. **Systems → Domain only** — no PixiJS, no ONNX in systems.
3. **Domain → nothing** — pure data + business rules.
4. **ONNX → Web Worker only** — never call `ort.InferenceSession.run()` on main thread.
5. **One save path** — only `SaveManager` touches IndexedDB.

---

## Part 4: Scene Navigation Graph

```
MainMenuScene
  ├─ "Новая игра" ──────► RaceSelectionScene ──► SpaceFlightScene
  │                              └─ "Назад" ──► MainMenuScene (REQUIRED)
  └─ "Продолжить" ─────► SpaceFlightScene (via loadGame)

SpaceFlightScene
  ├─ Click planet (hitArea) ────► PlanetInfoPanel (inline)
  │   └─ "Посадить" ───────────► PlanetScene
  ├─ Click station ─────────────► StationScene
  ├─ Click NPC ─────────────────► NpcContactPanel (inline)
  │   └─ "Атаковать" ──────────► real-time in-flight combat (CombatModule, no scene change)
  │        (hex CombatScene is now reached only from scripted TextQuestScene
  │         encounters and the OVERMIND-core boss fight)
  ├─ [M] / StarMap button ──────► StarMapScene
  │   └─ "Назад" ──────────────► SpaceFlightScene (REQUIRED)
  ├─ [J] ───────────────────────► QuestJournalUI (overlay)
  └─ [I] ───────────────────────► InventoryScene

PlanetScene
  ├─ "Губернатор" ──────────────► GovernmentScene ──► TextQuestScene
  ├─ "Маркет" ──────────────────► TradeScene
  ├─ "Снаряжение" ─────────────► EquipmentShopScene
  ├─ "Инфоцентр" ──────────────► InfoCenterScene
  └─ "Взлёт" ───────────────────► SpaceFlightScene

StationScene (inline sub-views)
  ├─ Shop sub-view
  ├─ Hangar sub-view
  ├─ Micromodule sub-view
  ├─ "Инфоцентр" ──────────────► InfoCenterScene
  └─ "Отстыковаться" [Esc] ────► SpaceFlightScene

[WIN_SCREEN] ────────────────────► MainMenuScene
```

---

## Part 5: Coding Approach

### 5.1 Invariants (never break these)

1. **No ONNX on main thread.** All inference via `ONNXModelRegistry.infer()` → Web Worker.
2. **No direct IndexedDB access outside SaveManager.**
3. **No PixiJS in Domain or Systems layers.**
4. **No global state mutation outside designated entry points:**
   - Reputation: only via `Player.adjustReputation(factionId, delta)`
   - Credits: only via `Player.addCredits(amount)` / `Player.spendCredits(amount)`
   - Scene transitions: only via `GameEngine.transitionTo(scene, ctx)`
5. **Geometry constants in `src/config/balance.ts`** — never hard-coded in scene files.
6. **`SpaceFlightScene` must stay under 500 lines** — extract to helpers/systems for anything > 30 lines of logic.

### 5.2 PixiJS Event Handling Rules (see CLAUDE.md for full rules)

| Rule | Summary |
|------|---------|
| R1 | Never `eventMode='none'` on containers with interactive children |
| R2 | Always `event.stopPropagation()` in UI handlers above `gameLayer` |
| R3 | `eventMode='none'` on all `Text` overlaid on clickable `Graphics` |
| R4 | Distinguish mouse buttons: `button===0` primary, `button===2` pan |
| R5 | Update minimap scale when world scale changes |
| R6 | Apply camera transforms to `gameLayer` only (single transform point) |
| R7 | If a fix creates new bugs, revisit root cause (avoid ping-pong fixes) |
| R8 | Pass scene context explicitly via params, not global flags |

### 5.3 Error and Logging

- Throw: `GameBusinessException` | `GameSystemException` | `GameValidationException` | `InferenceException`
- Log: `src/utils/logger.ts` only — no `console.log`
- `FallbackEngine` must `logger.warn` every call it intercepts

### 5.4 New Scene Checklist

- [ ] Extends `GameScene` in `src/presentation/`
- [ ] `SceneType.MY_SCENE` added to `src/types/index.ts`
- [ ] Case in `SceneFactory.ts`
- [ ] If context-dependent → added to `contextDependentScenes` in `GameEngine.loadGame()`
- [ ] Page Object in `e2e/page-objects/` for E2E hooks
- [ ] `destroy()` cleans up ALL DisplayObjects, intervals, null refs

### 5.5 New Domain Field Checklist

- [ ] Type in `src/types/index.ts` or `src/domain/*.ts`
- [ ] Zod schema in `src/validation/schemas.ts`
- [ ] Migration in `src/data/MigrationPipeline.ts` if save format changes

---

## Part 6: Code Review Approach

### 6.1 When to review

Every PR touching gameplay logic, presentation, or domain models. Skip: docs-only, config-only changes with no logic.

### 6.2 Review checklist

**Architecture**
- [ ] No cross-layer imports (Presentation importing Systems directly, Domain importing PixiJS, etc.)
- [ ] `SpaceFlightScene` not growing beyond 500 LOC
- [ ] New geometry constants in `balance.ts`, not inline

**PixiJS correctness**
- [ ] No `eventMode='none'` on containers with interactive children
- [ ] `stopPropagation()` in every UI handler over `gameLayer`/`stage`
- [ ] `eventMode='none'` on every `Text` overlaid on clickable area
- [ ] No hard-coded pixel coordinates for hit detection
- [ ] `destroy()` nulls all DisplayObjects and listeners

**Domain + types**
- [ ] Any `src/types/index.ts` change → `src/validation/schemas.ts` updated
- [ ] No `any` or `unknown` in quest/trade/combat code

**Testing**
- [ ] New business logic has unit tests in `src/tests/`
- [ ] New E2E flow has a page object hook, not a coordinate click

**Other**
- [ ] No `console.log` (use `logger`)
- [ ] No `waitForTimeout` in tests (use `waitForFunction`)
- [ ] No `canvas.click({position})` in E2E tests

### 6.3 Severity levels

| Level | Meaning | Action |
|-------|---------|--------|
| **Blocker** | Breaks architecture invariant or causes data loss | Must fix before merge |
| **Major** | Logic bug or rule violation | Must fix before merge |
| **Minor** | Style, naming, cleanup | Fix if easy; otherwise track in backlog |
| **Nitpick** | Optional improvement | Author's discretion |

---

## Part 7: UX Review Approach

### 7.1 When to run a UX review

- When implementing any user-facing scene, panel, or button
- When changing an existing interaction (drag, click, hover, keyboard shortcut)
- Before marking a sprint "Done"

### 7.2 UX review checklist

**Navigation**
- [ ] Every scene has at least one visible exit (Back button or Esc label)
- [ ] No keyboard-only path for a primary action
- [ ] Loading/transition state shown during all async scene changes

**Feedback**
- [ ] Every button click gives a visible response ≤ 200 ms
- [ ] Destructive/expensive actions have confirmation or undo
- [ ] Error messages are in the UI language and persist long enough to read (≥ 5 s)
- [ ] Toast messages are auto-removed by a timer (never accumulate)

**Visual consistency**
- [ ] Scene titles and buttons are in the game language (Russian) — no English strings in Russian UI
- [ ] Buttons use one of two consistent patterns (text-bracket or Graphics-background)
- [ ] Disabled elements have contrast ≥ WCAG AA (4.5:1) or are clearly dimmed

**Mouse-first (see §3 Mouse-First Rules)**
- [ ] All primary actions reachable with mouse only
- [ ] RMB always pans; scroll always zooms
- [ ] Zoom preserves world point under cursor

**Accessibility**
- [ ] No red/green-only semantic pair (add shape or icon)
- [ ] No text smaller than 12px for interactive elements; 10px max for decorative-only
- [ ] Interactive hit areas ≥ 30 × 30 px (desktop threshold)

### 7.3 Mouse-First rules (canonical, §3 of SOURCE-OF-TRUTH)

| Code | Rule |
|------|------|
| A1 | All primary actions mouse-accessible; keyboard = accelerators only |
| A2 | Every click gives visible feedback ≤ 200 ms |
| A3 | RMB + drag = pan, always (pause / turn running / panel open) |
| A4 | Scroll wheel = zoom only |
| A5 | Zoom preserves world point under cursor |
| A6 | LMB click = set route; second click same point = cancel route |
| A7 | Click planet = land menu (enlarged hitArea) |
| A8 | "⊙" minimap button always returns camera to ship |

---

## Part 8: Task Execution Approach

### 8.1 Task lifecycle

```
Planned
  → In Progress   (create TaskCreate; start coding)
  → [build green + tests green + lint clean]
  → Code Review   (use /code-review skill or manual checklist)
  → UX Review     (use /ux-reviewer if any UI changes)
  → Done          (update US-XXX.md status; close task)
```

### 8.2 Definition of Done

A task is **Done** only when ALL of the following are true:

1. `npm test -- --run` — all tests green (including the new ones for this task)
2. `npm run lint` — zero errors
3. `npm run build` — no TypeScript errors
4. Code Review checklist passed (Part 6)
5. UX Review checklist passed if UI was changed (Part 7)
6. The acceptance criteria in the linked US file are all checked off

### 8.3 Test-first rule

Write the test **before** the implementation:
1. Write a failing test that defines the acceptance criterion
2. Implement the minimum code to make it pass
3. Refactor, keeping tests green

### 8.4 Task decomposition rule

If a task takes > 1 day estimated, split it. Each sub-task must independently satisfy DoD. Never merge "work in progress" tasks.

### 8.5 Anti-patterns to avoid

| Anti-pattern | Why bad | Alternative |
|-------------|---------|-------------|
| `waitForTimeout` in tests | Fragile, slow | `waitForFunction` / `waitForSelector` |
| `canvas.click({position})` in E2E | Breaks on any layout change | `window.__gameEngine.scene.e2eXxx()` |
| Ping-pong fix (fix A breaks B breaks C) | Symptom treatment | Find root cause; fix once |
| Growing `SpaceFlightScene` | Unmaintainable | Extract to helper/system |
| Global flag for scene context | Race conditions | Pass context via `transitionTo(scene, ctx)` |
| `eventMode='none'` on containers | Blocks all children events | Only on leaf non-interactive nodes |
