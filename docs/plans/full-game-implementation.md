# Plan: Space Rangers — Neural Onslaught: Full Game Implementation

## Overview

Browser-based space RPG/strategy with local ONNX models. Stack: TypeScript, PixiJS 8,
onnxruntime-web, Vite, Vitest. Architecture: Presentation → Systems → Domain → AI/Infrastructure
(strict layer direction). All PixiJS event rules are in CLAUDE.md (stopPropagation, eventMode,
hitArea, etc.) — follow them exactly.

**What is already done (do not re-implement):**
- Features 1–9: main menu, star map, space flight scene, planet landing, basic quests,
  NPC living galaxy (spawning, movement, contact panel, orbit behind planets), minimap,
  parallax background with nebula/stars/sun halo, warp mechanics, in-flight auto-attack,
  turn-based Play/Pause.
- EPIC-001 base: TradeScene, Market, buy/sell, per-planet price spreads (US-006).
- EPIC-006 base: StationScene with shop + hangar (equip/unequip), InfoCenterScene (basic).
- EPIC-007 base: GearCatalog, ShopGenerator, gearMarketPrice, ShipLoadout.applyMicromodule.
- EPIC-008 base: QuestGenerator, galaxy-reach BFS, economics, GalacticRegistry with
  findGear/bestGear/findShip queries, job board panel (partial).

**Remaining work, in dependency order:**
A. Economy & planet services (EPIC-006/001)
B. Ship fitting complete (EPIC-007)
C. Combat complete (EPIC-002)
D. Living galaxy complete (EPIC-003)
E. Quest director (EPIC-008)
F. Text quests on ONNX (EPIC-005)
G. Information system tabs (EPIC-009)
H. Progression & end game
I. Polish & production

**Architectural rules to follow in every task:**
- `src/domain/` — pure data, no PixiJS/ONNX.
- Throw only GameBusinessException/GameSystemException/GameValidationException/InferenceException.
- Use `src/utils/logger.ts` (not console.log).
- Any change to `src/types/index.ts` or `src/domain/*.ts` → update `src/validation/schemas.ts`.
- ONNX inference only in workers via ONNXModelRegistry.infer(), never on main thread.
- PixiJS: stopPropagation on all UI buttons; text elements over clickable areas get eventMode='none'.

## Validation Commands

- `npx tsc --noEmit`
- `npm test -- --run`
- `npm run lint`
- `npm run build`

---

## Group A: Economy & Planet Services

### Task 1: Economy types, political systems, and dynamic market prices

Implement planet economy type (AGRICULTURAL/INDUSTRIAL/MIXED) and political system
(ANARCHY/DICTATORSHIP/MONARCHY/REPUBLIC/DEMOCRACY) affecting pricing tiers and good legality.
Add supply/demand simulation: each day advance, each planet's market shifts prices based on
NPC trade activity and base consumption. Economy type comes from StarSystem domain (add field).

- [x] Add `economyType: EconomyType` and `politicalSystem: PoliticalSystem` enums + fields to
  `StarSystem` in `src/types/index.ts` and `src/domain/Galaxy.ts`; assign deterministically
  from system seed in `src/systems/GalaxyGenerator.ts`.
- [x] Update `src/validation/schemas.ts` for the new StarSystem fields; add migration in
  `src/data/MigrationPipeline.ts` that defaults old saves to MIXED/REPUBLIC.
- [x] In `src/systems/TradeSystem.ts`, compute price multiplier from economy type:
  AGRICULTURAL → food/medicine 0.7×, tech/luxury 1.4×; INDUSTRIAL → tech/equipment 0.7×,
  food 1.3×; MIXED → 1.0×. Apply in `getPrice()`.
- [x] Add daily supply/demand drift to `Market`: each `advanceMarketDay()` call (invoked from
  `GameEngine.advanceGalaxyDay()`) adjusts each good's price ±2–8% toward its economy-type
  baseline. Price is clamped to [base×0.4, base×2.5]. Persist market state in save.
- [x] Political system → legality map: ANARCHY allows all; DICTATORSHIP bans alcohol/narcotics;
  DEMOCRACY allows all legal; REPUBLIC bans weapons; create `isLegal(good, politicalSystem)` in
  `src/systems/TradeSystem.ts`.
- [x] Unit tests: price tiers by economy type; daily drift stays in bounds; legality map for all
  political systems.

### Task 2: Reputation gating and bribe mechanic

Services become unavailable when player reputation with the planet's faction is below a threshold.
Add a bribe option that costs credits and temporarily restores access for one landing.

- [x] Add `getReputation(factionId): number` helper to `Player` (wraps `player.reputation` map).
  Thresholds: < -30 → hostile (no shop/trade/info); -30..0 → neutral (all services); > 0 → ally
  (discount). Implement in `src/domain/Player.ts`.
- [x] In `src/presentation/PlanetScene.ts`, check reputation on render: disable (gray + tooltip
  "Враждебное отношение") the shop/trade/info buttons when hostile. Show "Дать взятку (500 ₡)"
  button when hostile. Bribe: `player.credits -= 500`, temp flag `bribed = true` on PlanetScene
  instance, re-render buttons active.
- [x] Same reputation check in `src/presentation/StationScene.ts` for station services.
- [x] Faction for a planet comes from `planet.factionId` (already exists on Planet domain).
- [x] Unit test: `getReputation` returns correct value; bribe decrements credits.

### Task 3: Smuggling — illegal goods and customs risk

When the player lands on a planet with illegal goods in their inventory, there is a random customs
check. Penalty: fine + reputation loss. Player can choose to try to bribe customs.

- [x] Add `isContraband: boolean` property to TradeGood based on legality at destination.
  When player buys a good that is illegal at the planet, mark it in inventory: add
  `legal: boolean` to inventory slot metadata (or a `contrabandGoods: Set<string>` on Player).
  Simplest: add `contrabandGoods: string[]` (good IDs) to `Player` domain, persist in schemas.
- [x] On planet landing (`PlanetScene.initialize()`): if player has any goods illegal at this
  planet, roll a customs check (30% chance). If triggered, show a modal:
  "Таможенный досмотр. Обнаружен нелегальный груз. Штраф: X ₡ / Дать взятку (Y ₡) / Выбросить груз".
  Penalty = good value × 1.5 credits + reputation -20. Bribe = penalty × 0.6, no rep loss.
  Dump: goods removed, no penalty.
- [x] Implement customs modal in `PlanetScene` using existing modal pattern (Container with
  stopPropagation, ✕ close, buttons).
- [x] Unit test: contraband detection; penalty calculation.

### Task 4: Government dialogue scene

Add a GovernmentScene accessible from the planet hub (replaces the stub Governor button).
Shows faction info, player reputation, and dialogue lines based on reputation tier.
Offers reputation-gated quests (hooks into the job board from Task 16).

- [x] Create `src/presentation/GovernmentScene.ts` extending GameScene. Context: `{ gameEngine,
  planet }`. Shows: planet name, faction name/colour, political system, economy type, population
  (formatted), player reputation (number + label "Враг/Нейтрал/Союзник").
- [x] 3–5 dialogue lines from the governor, determined by reputation tier (hostile/neutral/ally).
  Lines are template strings in a config map (no ONNX yet — that's Task 21).
- [x] "Задания" button → transition to PlanetScene job board (or inline a 3-quest mini-board —
  see Task 16 for full board). For now, show "Заданий нет" if job board is not yet wired.
- [x] "Назад" → returns to PlanetScene.
- [x] Add `SceneType.GOVERNMENT` to `src/types/index.ts`; register in `GameEngine.transitionTo()`;
  wire `Governor` button in `PlanetScene` to transition to GovernmentScene.
- [x] Unit test: GovernmentScene initializes with planet context; dialogue lines match tier.

---

## Group B: Ship Fitting Complete

### Task 5: Hull series — ship classes with HP, slots, cargo

Add 6 hull classes (Light Fighter / Corvette / Frigate / Destroyer / Transport / Heavy Freighter),
each with distinct HP, weapon slots, equipment slots, and cargo capacity. Player can buy a new hull
at the equipment shop; this replaces their current hull and resets all module slots (modules go to
inventory).

- [x] Add `HullClass` enum and `HullSpec` (already partial in GearCatalog) with fields:
  `hullClass, maxHp, weaponSlots, equipmentSlots, cargoCapacity, techLevel`. Define 6 classes in
  `src/systems/equipment/GearCatalog.ts`.
- [x] Add `hullClass: HullClass` to `PlayerShip` domain. `PlayerShip` derives `maxHp`,
  `weaponSlots`, `equipmentSlots`, `cargoCapacity` from `hullClass` (not hardcoded). Update
  `PlayerShip` constructor + accessors. Update `src/validation/schemas.ts`; migration defaults
  old saves to `HullClass.CORVETTE`.
- [x] "Купить корпус" section in `src/presentation/EquipmentShopScene.ts`: list available hulls
  (filtered by planet tech level); buy = deduct credits, move all current modules to
  `player.inventory.modules`, set new `playerShip.hullClass`.
- [x] Unit tests: hull slot counts match spec; buying hull moves modules to inventory.

### Task 6: Equipment effects → real ship stats

`ShipLoadout.derive()` already exists but returns stubs. Wire it so installed modules actually
change ship stats used by game systems. ShipPhysics reads speed from derived stats. Broken/missing
engine blocks takeoff.

- [x] Implement `ShipLoadout.derive(modules)` fully:
  - Engine module → `maxSpeed` (0.05 base + tech × 0.03 px/ms).
  - Fuel tank → `maxFuel` (50 base + capacity × 20 units).
  - Radar → `radarRange` (600 base + tech × 200 px).
  - Droid → `repairRate` (1 + tier × 0.5 HP/day in flight).
  - Shield generator → `shieldHp` (0 base + tech × 30).
- [x] `ShipPhysics` (in `SpaceFlightScene`) reads `ship.loadout.derived.maxSpeed` instead of
  hardcoded `0.1`. If engine slot is empty → `maxSpeed = 0`.
- [x] In `PlanetScene` / `StationScene` takeoff handler: if `ship.loadout.derived.maxSpeed === 0`
  → show toast "Нет двигателя — взлёт невозможен" and block transition.
- [x] Droid repair: in `GameEngine.advanceGalaxyDay()`, if droid installed and hull < maxHp,
  `ship.hull += repairRate` (capped at maxHp).
- [x] Unit tests: derive() returns correct stats for each module type; takeoff blocked without engine.

### Task 7: Micromodules — crafting station and UI

Players find/buy micromodules (3 tiers) at crafting stations. A micromodule boosts one parameter
of a specific module; once applied, it cannot be removed. Wire the UI in the hangar panel.

- [x] Define `MicroModule` type in `src/types/index.ts`: `{ id, name, targetCategory, bonusType,
  bonusTier: 1|2|3 }`. Add 12 micromodule definitions in `GearCatalog` (2 per equipment
  category × 3 tiers isn't needed — just 4 categories × 3 tiers = 12).
- [x] `ShipLoadout.applyMicromodule(moduleIndex, micromodule)` is already implemented — verify it
  correctly mutates `modules[i].micromodule` and throws if already has one.
- [x] Add `MicroModuleStation` station type (sub-type of StationType) that sells micromodules.
  In `StationScene`, if station type is `CRAFT_CENTER`, show "Микромодули" service button.
  Service opens a panel listing available micromodules (generated by ShopGenerator for the station).
- [x] In the hangar panel (`StationScene.renderHangar()`): below each installed module that has no
  micromodule, show "[+ микромодуль]" button; opens a sub-panel listing micromodules from inventory
  whose `targetCategory` matches the module category. Selecting one calls `applyMicromodule`.
- [x] Add micromodule inventory to `Player.inventory` (already has `modules: ShipModule[]`; add
  `micromodules: MicroModule[]`). Add to schemas + migration.
- [x] Unit tests: applyMicromodule sets flag and rejects second application; derive() adds tier
  bonus from micromodule.

### Task 8: Scanner vs shield field, and NPC scan

Scanner power vs shield generator power determines visibility of NPC loadout. "Сканировать"
button in NpcContactPanel reveals the target's equipment if scanner > shield.

- [x] Add `scanPower: number` and `shieldPower: number` to `ShipLoadout.derived()`. Derive from
  radar module (scan) and shield generator (shield), using tech level as power.
- [x] `NpcShip` domain: add `loadoutSummary: string[]` (list of equipment names); generated in
  `NpcSimulator` when spawning (3 random equipment items at NPC tech level).
- [x] In `NpcContactPanel`: add "Сканировать" button. On click: if
  `player.ship.loadout.derived.scanPower > npc.shieldPower` → show panel with NPC loadout items.
  Else → "Цель защищена полем — сканирование невозможно".
- [x] CombatScene: shield HP from `shieldHp` derived stat absorbs incoming damage before hull.
  If no shield → direct hull damage. When `shieldHp` depleted mid-combat, it resets to 0 (no
  regen in combat without shield module).
- [x] Unit tests: scan succeeds when scanner > shield; shield absorbs damage before hull.

---

## Group C: Combat Complete

### Task 9: Combat AI — rule-based state machine

Replace the CombatScene AI stub with a working rule-based state machine: attack nearest enemy,
retreat when HP low, use weapons on cooldown, claim reward on victory.

- [x] Implement `CombatAI` class in `src/systems/CombatSystem.ts` (or new
  `src/systems/combat/CombatAI.ts`). State machine: IDLE → ATTACK (move toward player, fire
  when in range) → RETREAT (move away from player when HP < 30%). Uses `TacticalEncounter`
  hexgrid for pathfinding (BFS to approach/flee).
- [x] Wire into `CombatSystem.executeTurn()`: after player action, iterate all enemy ships and
  call `CombatAI.decide(enemy, board)` to get their actions (move + attack or retreat).
- [x] Victory condition: all enemies HP ≤ 0 → `CombatSystem.resolveVictory()` — awards credits
  (sum of enemy base value) + random equipment drop (30% chance per enemy, tier = enemy tech
  level). Credits added to `player.credits`; equipment to `player.inventory.modules`.
- [x] Defeat condition: player HP ≤ 0 → retreat (HP set to 1) or save-restore. Show outcome
  panel with "Победа! +N ₡ + [Предмет]" or "Поражение — корабль поврежден".
- [x] Unit tests: AI moves toward player; retreats at low HP; victory rewards computed correctly.

### Task 10: Weapon types and special abilities

Add 3 weapon classes (energy/kinetic/missile) with special abilities: EMP (disables shields for
2 turns), homing (auto-targets closest hex), burst (3-hex AoE). Add cooldown tracking in combat.

- [x] Add `WeaponAbility` enum: `NONE | EMP | HOMING | BURST`. Add `ability: WeaponAbility` and
  `cooldown: number` to `WeaponSpec` in `GearCatalog`. Define 6 weapon variants (2 per type).
- [x] In `CombatScene`, render weapon panel with cooldown indicators (gray overlay + countdown
  number). Disable weapon button when `cooldown > 0`.
- [x] Implement abilities in `CombatSystem.resolveAttack()`:
  - EMP: sets target.shieldDisabledTurns = 2; shield does not absorb damage while active.
  - HOMING: if player fires homing weapon, AI cannot dodge (hits regardless of hex adjacency).
  - BURST: damages all ships in 1-hex radius of target.
- [x] Cooldown: after firing, weapon cooldown = weapon.cooldownTurns. Decremented each turn.
- [x] Unit tests: EMP disables shield; burst hits adjacent; cooldown decrements per turn.

### Task 11: Warp-to-combat bridge (EPIC-003 US-036)

"Атаковать" on an NPC ship from the contact panel transitions to CombatScene with that NPC as the
enemy. Post-combat: if player wins, NPC is removed from the system; if player retreats, NPC stays.

- [x] In `SpaceFlightScene.onNpcClick()` / `NpcContactPanel`, when "Атаковать" is pressed and
  the player is within weapon range (`< WEAPON_RANGE`), stop the auto-follow and transition to
  `SceneType.COMBAT` with context `{ gameEngine, npcShip }` instead of the current in-flight
  auto-attack.
- [x] In `CombatScene.initialize()`, if context contains `npcShip`, build a `TacticalEncounter`
  enemy from the NPC's tech level and faction (using `loadoutSummary` for weapon/shield stats).
- [x] Post-combat callback: `CombatScene` calls `gameEngine.transitionTo(SceneType.SPACE_FLIGHT)`
  with `{ combatResult: 'victory' | 'retreat', npcId }`. In `SpaceFlightScene.initialize()`,
  if `combatResult === 'victory'`, remove the NpcShipSprite with that `npcId` and call
  `npcSimulator.removeNpc(npcId)` to clean up the domain.
- [x] Unit test: combat context built from NpcShip; victory removes NPC from domain.

---

## Group D: Living Galaxy Complete

### Task 12: NPC off-screen trading (market influence)

Trader NPCs carry cargo between systems and affect market prices when they land. This creates
emergent price differences the player can exploit.

- [x] Add `cargo: { goodId: string; qty: number }[]` to `NpcShip` domain. Persist in schemas.
  On spawn, `NpcSimulator` gives traders a random cargo load (1–3 goods, 5–20 units each) from
  the system's cheapest goods.
- [x] In `NpcSimulator.advanceDay()`: when a trader NPC "arrives" at a planet (changes system),
  simulate a trade: sell cargo at destination (increment that planet's market supply by qty,
  lowering price), buy new cargo at destination (decrement supply). Update `Market` state.
- [x] `NpcShip.cargo` is visible via scan (Task 8): when scanner > shield, show cargo manifest
  in the scan result panel.
- [x] Unit tests: trader cargo updates market supply; prices decrease after trade.

### Task 13: NPC off-screen questing and reputation

Ranger NPCs take quests from planets and complete them over time, earning reputation. Completed
NPC quests produce news events (visible in info center).

- [x] In `NpcSimulator.advanceDay()`: each ranger NPC has a 10% daily chance to "accept" a
  random delivery quest from their current system (target = a random other system). Add
  `activeQuestTarget: string | null` to `NpcShip`. When ranger arrives at target system →
  quest complete: ranger reputation with issuing faction +10, emit a news event
  `{ type: 'NPC_QUEST_COMPLETE', npcId, systemId, day }`.
- [x] Collect news events in `GalacticRegistry.newsFeed: NewsEvent[]` (append, keep last 50).
  `advanceGalaxyDay()` in `GameEngine` publishes events after NpcSimulator tick.
- [x] Pirates: 5% daily chance to attack a trader NPC in the same system. If attacked, trader
  loses cargo (clear cargo array); emit `{ type: 'PIRATE_ATTACK', systemId, day }` news event.
- [x] Unit tests: ranger quest completion emits news event; pirate attack clears trader cargo.

---

## Group E: Quest Director

### Task 14: Galaxy-spanning quest objectives

Quests from the job board must lead the player to OTHER systems. Implement the objective-closing
loop: delivery quests close when cargo arrives at target; bounty quests close when the target NPC
is destroyed.

- [x] Add `targetSystemId: string | null` and `targetObjectId: string | null` to `Quest` domain
  (already has objective). Update schemas + migration (default null). Update `QuestGenerator` to
  set targetSystemId from the existing BFS galaxy-reach logic (it generates this but doesn't save
  it to the Quest — wire it up).
- [x] DELIVERY quests: when player lands on a planet in `targetSystemId` carrying the quest cargo
  good in inventory → auto-complete the quest from `PlanetScene.initialize()`. Reward: credits +
  reputation. Remove the cargo good from inventory.
- [x] BOUNTY quests: `targetObjectId` is an NpcShip id. When that NpcShip is destroyed
  (Task 11 victory callback), check active bounty quests targeting that id → auto-complete.
- [x] EXPLORATION quests: `targetSystemId` is any system. Quest completes when player jumps
  into that system (check in `SpaceFlightScene.initialize()`).
- [x] Unit tests: delivery closes on correct planet; bounty closes on NPC death; exploration
  closes on system entry.

### Task 15: Job board completion and quest persistence

The existing `JobBoardPanel` is partial. Complete it: board refreshes each day, shows quest type/
target/reward/deadline, player can accept up to 3 active quests. Persist board + accepted quests.

- [ ] In `PlanetScene`, wire the "Задания" button to show a full JobBoardPanel with quests from
  `GameEngine.getQuestBoard(planetId)` (already exists). Show: type icon, destination system
  name, reward, deadline (days remaining), "Принять" button. Disable if quest already accepted
  or player has 3 active quests.
- [ ] `GameEngine.acceptBoardQuest()` already exists — verify it correctly moves quest from board
  to `player.activeQuests` and updates QuestJournalUI.
- [ ] Board refresh: `GameEngine.advanceGalaxyDay()` calls `QuestGenerator.refresh(planet, day)`
  every 3 days per planet (or daily if board has < 2 quests). Board state persists in
  `galaxy.questBoards: Map<planetId, Quest[]>`. Add to schemas + migration.
- [ ] Deadline expiry in `GameEngine.checkExpiredQuests()` (already exists — verify it deducts
  `failurePenalty` credits and reputation, and removes quest from active list).
- [ ] Unit tests: board generates 3–5 quests; accept moves quest to active; expiry deducts penalty.

### Task 16: Reputation gates and quest chains

High-value quests (elite government contracts, rescue missions) only appear when player reputation
with the issuing faction is above a threshold. Completing a chain of 3 related quests unlocks a
harder one with a bigger reward.

- [ ] Add `minReputation: number` and `chainId: string | null` to `Quest` domain. In
  `QuestGenerator`, generate "elite" quest tier (20% of board) with `minReputation = 50` and
  double the reward. In `GameEngine.getQuestBoard()`, filter out quests where
  `player.getReputation(faction) < quest.minReputation`.
- [ ] Quest chains: `QuestGenerator` can emit 3 sequential quests sharing a `chainId`
  (e.g., `courier-chain-{systemId}-{seed}`). When all 3 are complete, unlock a 4th
  "chain finale" quest with ×3 reward. Track completed chain quests in
  `player.completedQuestChains: string[]` (add to schemas).
- [ ] Text-quest ratio: `QuestGenerator` emits `QuestType.TEXT_ADVENTURE` at ~20% of board
  (controlled by `QUEST_TEXT_RATIO = 0.2` constant). For now, accepting a TEXT_ADVENTURE quest
  shows a "Текст-квест (скоро)" toast — the scene will be wired in Task 21.
- [ ] Unit tests: elite quest filtered by reputation; chain completes when all 3 done; ratio
  emits correct TEXT_ADVENTURE proportion.

---

## Group F: Text Quests on ONNX

### Task 17: Text quest graph domain and runtime engine

The text-quest graph is pure data: nodes, choices, conditions, outcomes. The runtime engine
traverses the graph, checks conditions (credits/reputation/inventory), applies outcomes.

- [ ] Define types in `src/types/index.ts`:
  `QuestNode { id, textKey, choices: QuestChoice[] }`
  `QuestChoice { label, conditions: QuestCondition[], nextNodeId, outcome: QuestOutcome | null }`
  `QuestCondition { type: 'credits'|'reputation'|'item', comparison, value }`
  `QuestOutcome { creditsDelta, reputationDelta, factionId?, itemGained?, itemLost?, journalEntry }`
- [ ] Create `src/domain/TextQuest.ts`: immutable quest graph. Create 2 sample quests:
  - Logical: "Тайный груз" (3-node, 2 fail branches, logical puzzle about codes).
  - Atmospheric: "Дрейфующий корабль" (4-node, branching moral choice).
- [ ] Create `src/systems/quests/TextQuestRuntime.ts`: `start(quest, player)` → returns first
  node; `choose(nodeId, choiceIdx, player)` → checks conditions → returns next node or throws
  `GameBusinessException` if condition fails; `applyOutcome(outcome, player)` → mutates player
  state.
- [ ] Add `TextQuestRuntime` to `GameEngine`; add `activeTextQuestState: TextQuestState | null`
  to Player domain (current node id + seed + accumulated outcomes). Update schemas.
- [ ] Unit tests: all paths through both sample quests; condition checks; outcome application.

### Task 18: ONNX narrator with template fallback

`QuestNarrator` interface with two implementations: `OnnxQuestNarrator` (inference in worker)
and `TemplateQuestNarrator` (fallback with parameterized sentences). The scene (Task 19) calls
the narrator interface, never caring which is active.

- [ ] Define `QuestNarrator` interface in `src/ai/adapters/QuestNarrator.ts`:
  `{ narrate(nodeTextKey: string, context: NarratorContext): Promise<string> }`.
  `NarratorContext` = `{ role: string, tone: string, systemName: string, daysSinceStart: number }`.
- [ ] Implement `TemplateQuestNarrator`: maps `nodeTextKey` to parameterized template strings
  (one paragraph each), substituting context variables. No ONNX, always synchronous-ish.
- [ ] Implement `OnnxQuestNarrator`: build a prompt from `nodeTextKey + context`, call
  `ONNXModelRegistry.infer('dialogue', prompt)` in the worker. If model not loaded or inference
  times out, fall back to `TemplateQuestNarrator`. Wrap `InferenceException` gracefully.
- [ ] Register narrator in `GameEngine`: use `OnnxQuestNarrator` with auto-fallback.
- [ ] Unit tests: `TemplateQuestNarrator` returns non-empty string for all sample quest node keys;
  fallback activates when ONNX is mocked to reject.

### Task 19: Text quest scene UI and outcome application

`TextQuestScene` shows the generated node text and up to 4 choice buttons. Applying an outcome
changes credits/reputation/inventory and writes a journal entry. Triggers from NPC contact and
government.

- [ ] Create `src/presentation/TextQuestScene.ts` extending GameScene. Context:
  `{ gameEngine, quest: TextQuest, returnScene: SceneType, returnContext }`.
  Layout: full-screen dark panel, scrollable narration text area (top 60%), choice buttons
  (bottom 40%). "Отмена/Выйти" exits without completing, returns to returnScene.
- [ ] On initialize: start TextQuestRuntime, call narrator.narrate(firstNode.textKey, ctx), show
  text. Choice buttons: show choice.label; gray + tooltip if condition fails (show reason).
- [ ] On choice click: TextQuestRuntime.choose() → if next node → narrate + update buttons;
  if terminal node (no choices) → apply outcome, show result panel "Квест завершён: +N ₡ /
  −N репутации / Получен [предмет]", add journal entry, transition back.
- [ ] Wire triggers:
  - NpcContactPanel: "Связаться" with ranger NPC that has an active quest → if player has
    TEXT_ADVENTURE quest targeting this NPC → transition to TextQuestScene.
  - GovernmentScene "Задания": if board contains a TEXT_ADVENTURE quest → transition.
- [ ] Unit tests: scene transitions through a 3-node quest path; outcome applied to player state.

---

## Group G: Information System

### Task 20: News feed with simulation events

The info center's news tab aggregates events from the simulation (NPC actions, market shifts,
OVERMIND expansion) and presents them with timestamps and a bookmark toggle.

- [ ] Define `NewsEvent { type, day, systemId?, npcId?, description: string }` in types.
  `GalacticRegistry.newsFeed: NewsEvent[]` (already added in Task 13 — extend with all event types
  from OVERMIND, market, NPC quests, pirate attacks).
- [ ] In `GameEngine.advanceGalaxyDay()`, after each day tick: collect events from NpcSimulator,
  market drift, and OVERMIND (Task 26). Append to `registry.newsFeed` (keep last 100). Persist
  in save (add to schemas).
- [ ] `InfoCenterScene` news tab: vertical scrollable list of news items. Each item: day badge,
  type icon, description text, ★ bookmark toggle. Bookmarks stored in `player.newsBookmarks:
  number[]` (news event day + type hash). Persist in schemas.
- [ ] Faction and reputation gate: if player reputation with the station/planet faction < -30 →
  show "Инфоцентр недоступен" and block access (already done for StationScene — extend to all).
- [ ] Unit tests: news events appended correctly; bookmark toggle persists.

### Task 21: Info center tabs — object search and gear search

Add two more tabs to InfoCenterScene: "Поиск объектов" (NPC locations, planet services) and
"Снаряжение" (gear parameter search with jump distance). Data fog: distant/unvisited systems
show stale data.

- [ ] Refactor `InfoCenterScene` to have 3 tabs: "Новости" / "Объекты" / "Снаряжение".
  Tab switcher: 3 text buttons at top, highlighted active tab. Each tab renders its content area.
- [ ] "Объекты" tab: text input "Поиск NPC / планеты". On submit: call
  `GalacticRegistry.findShip(name)` and `findPlanet(name)` → show name, current system, distance
  in jumps (use `galaxy.jumpDistance(player.currentSystemId, targetSystemId)`). "Проложить
  маршрут" button sets the star map warp target.
- [ ] "Снаряжение" tab: dropdowns for `kind` (hull/weapon/equipment), tech level range min/max,
  max price, sort by (price/tech/distance). "Найти" → calls `GalacticRegistry.findGear(query)` →
  list results: item name, system, planet, price, jumps. Tap result → show system on star map.
- [ ] Data fog: if `galaxy.systems[id].lastVisitedDay` is undefined (never visited) or >30 days
  ago, mark results from that system with "(устаревшие данные)". Track `lastVisitedDay` in
  StarSystem (add to schemas); update in `SpaceFlightScene.initialize()`.
- [ ] Unit tests: search returns sorted results; unvisited systems flagged; visited systems updated.

---

## Group H: Progression & End Game

### Task 22: Rank system and military bases

Kill points accumulate from combat victories. Military base stations let players cash in points
for a rank promotion. Higher ranks unlock elite quests and faction discounts.

- [ ] Add `killPoints: number` and `rank: number` (0–7) to `Player` domain. Update schemas.
  Each enemy ship destroyed in combat: `player.killPoints += enemyTechLevel × 10`.
- [ ] `RANK_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000, 8000]` in balance config. Rank
  label names (our own, non-canon): Новобранец / Пилот / Ветеран / Аса / Мастер / Командор /
  Адмирал / Легенда.
- [ ] Add `StationType.MILITARY_BASE` (already exists). In `StationScene` for military bases,
  show "Получить звание" button: if `player.killPoints >= RANK_THRESHOLDS[player.rank + 1]` →
  promote: `player.rank++`, `player.killPoints = 0`, show congratulation panel.
- [ ] `QuestGenerator`: elite quests (`minReputation = 50`) also require `minRank = 3` (Аса).
  Government faction discount at rank ≥ 5: prices ×0.85.
- [ ] Unit tests: kill points accumulate; promotion at threshold; elite quest gated by rank.

### Task 23: OVERMIND threat arc and win/loss conditions

OVERMIND (ancient threat) controls some systems and expands daily. If it takes >50% of systems →
game loss. Player can take anti-OVERMIND quests to push it back. Destroying the OVERMIND core
system → win.

- [ ] Add `overmindSystems: Set<string>` and `overmindCoreSystemId: string` to `Galaxy`. On
  galaxy generation, assign 2 starting OVERMIND systems (from isolated edge systems). Update
  schemas + migration (default empty set; core = last system by ID).
- [ ] OVERMIND expansion in `GalaxySimulator.advanceDay()`: every 5 days, OVERMIND takes an
  adjacent non-player system (BFS neighbor of any OVERMIND system). Emit news event "OVERMIND
  захватил систему [name]".
- [ ] Win condition: when player jumps into `overmindCoreSystemId` and wins a combat encounter
  (`CombatSystem` returns victory with a special "CORE_DESTROYED" flag), game win screen shows.
- [ ] Loss condition: checked each day advance — if `overmindSystems.size > galaxy.systems.length
  / 2` → game over screen ("Галактика пала").
- [ ] Anti-OVERMIND quests: `QuestGenerator` adds 1 DEFENSE quest type (requires player to fly
  to an OVERMIND-adjacent system; on arrival, OVERMIND loses that system).
- [ ] Win/loss screens: simple PixiJS overlay with outcome text and "Начать заново" button.
- [ ] Unit tests: OVERMIND expansion increments; loss condition triggers at >50%; defense quest
  removes system from OVERMIND set.

### Task 24: Global events system

Random galaxy events (pirate surge, trade boom, plague, discovery) fire every 7–15 days,
affecting markets, NPC spawns, and reputation. Published to news feed.

- [ ] Define `GalaxyEvent` type: `{ type: PirateSurge|TradeBoom|Plague|Discovery, systemId,
  severity: 1|2|3, day }`. In `GalaxySimulator`, roll a random event every 7–15 days (seeded
  from `galaxy.seed + gameDays`).
- [ ] Effects by type:
  - PirateSurge: spawn +3 pirate NPCs in target system; prices rise +20% in that system.
  - TradeBoom: all prices in target system drop -15% for 10 days.
  - Plague: target planet `population -= 30%` (affects quest board and market capacity).
  - Discovery: reveal a previously foggy system; news item says what was found (derelict/mineral).
- [ ] Events appended to `registry.newsFeed` with descriptive text.
- [ ] Unit tests: each event type applies correct effect; events are seeded (deterministic).

---

## Group I: Polish & Production

### Task 25: Save migration pipeline and schema completeness

Ensure all new domain fields from Tasks 1–24 have Zod schemas and migration steps. Old saves
load cleanly with sensible defaults.

- [ ] Audit `src/validation/schemas.ts`: verify every field added in Tasks 1–24 has a
  corresponding Zod schema with a `.default()` or `.optional()` so old saves don't fail.
- [ ] `src/data/MigrationPipeline.ts`: add migration version bump (one per major field group
  from this plan). Each migration step is a pure function that adds missing fields with defaults.
  Test that a save from "version 0" (pre-plan) loads and runs without errors.
- [ ] `GameEngine.rehydrateLoadedState()`: verify all new domain class instances are properly
  reconstructed (not plain objects). Add `PlayerShip`, `ShipLoadout`, `TextQuestState` to the
  class-restoration switch.
- [ ] Unit tests: migration from version 0 → current produces a valid, fully typed save object.

### Task 26: Audio integration

AudioManager plays background music tracks by game state and SFX for key actions.
Track-to-state mapping from `docs/design/AUDIO_TRACKLIST.md`.

- [ ] Implement `src/systems/AudioManager.ts`: wraps Web Audio API. Methods: `playTrack(key)`,
  `stopTrack()`, `playSfx(key)`. Tracks loaded from `public/audio/mus_<key>.ogg` (Vite serves
  from public). SFX from `public/audio/sfx_<key>.ogg`. Fade in/out over 1s for track transitions.
- [ ] State → track key mapping from AUDIO_TRACKLIST.md. Wire transitions:
  - StarMapScene → `mus_starmap`; SpaceFlightScene → `mus_flight`; CombatScene → `mus_combat`;
  - PlanetScene → `mus_planet`; TextQuestScene → `mus_quest`.
- [ ] SFX: warp jump → `sfx_warp`; purchase → `sfx_buy`; combat hit → `sfx_hit`;
  landing → `sfx_land`; quest complete → `sfx_reward`. Play from the corresponding scene event.
- [ ] AudioManager registered in `GameEngine`; scenes call `gameEngine.audio.playTrack(...)`.
- [ ] Guard: if no audio file found, log a warn and continue silently (assets are optional).

### Task 27: E2E test coverage for key flows

Playwright E2E tests for the three critical player loops: shopping + equipping, quest accept +
complete, and combat + reward.

- [ ] E2E: `e2e/shop-and-equip.spec.ts` — Start game → fly to planet → open equipment shop →
  buy an item → open hangar → equip item → verify stat bar shows updated speed.
  Use `window.__gameEngine` to drive transitions; assert via DOM or `__gameEngine` state.
- [ ] E2E: `e2e/quest-accept-complete.spec.ts` — Start game → accept a DELIVERY quest from job
  board → fly to target system (jump) → land on target planet → quest auto-completes →
  credits increased by reward amount.
- [ ] E2E: `e2e/combat-flow.spec.ts` — Start game → find NPC → attack → combat scene opens →
  AI takes a turn → player attacks → enemy destroyed → victory panel shown → credits awarded.
- [ ] All E2E tests must use `waitForFunction` / `waitForSelector`, no `waitForTimeout`.
  No `canvas.click({ position })` — use `page.evaluate(() => window.__gameEngine...)`.

### Task 28: Split SpaceFlightScene and fix God-class violations

Extract `ShipPhysics` to its own file and move combat-resolution logic to `FlightCombatResolver`.
Wire `Player.adjustReputation()` to replace all `as any` reputation casts.

- [ ] Move `ShipPhysics` inner class from `SpaceFlightScene` to
  `src/systems/ShipPhysics.ts`. Update `SpaceFlightScene` to import it. Verify all 160 tests
  still pass (ShipPhysics is now testable in isolation — add 5 unit tests for physics state machine).
- [ ] Create `src/systems/FlightCombatResolver.ts` extracting the auto-attack logic from
  `SpaceFlightScene.updateCombat()` (~80 lines). `SpaceFlightScene` delegates to it.
- [ ] Add `Player.adjustReputation(factionId: string, delta: number): void` in
  `src/domain/Player.ts`. Replace all `as any` casts in `DialogueSystem.ts` with calls to
  `player.adjustReputation()`.
- [ ] Fix `QuestLog`: change `activeQuests: unknown[]` and `completedQuests: unknown[]` to
  `Quest[]` and `string[]` in `src/types/index.ts`. Fix the cast in `GameEngine.saveGame()`.
- [ ] Fix `InventoryScene.ts` `'SPACE_FLIGHT' as any` → `SceneType.SPACE_FLIGHT`.
- [ ] Guard stub AI adapters with `if (!__DEBUG__) logger.warn(...)` in PPOAdapter, VAEAdapter,
  GRUAdapter, T5DialogueAdapter.

### Task 29: Star map fog of war and faction home systems

Unvisited star systems appear as question marks on the star map. Faction home systems are marked
with faction colors and generate faction-specific quests from day 1.

- [ ] Add `visitedSystems: Set<string>` to `Player` domain. Update schemas. Update
  `SpaceFlightScene.initialize()` to add `player.currentSystemId` to `visitedSystems`.
- [ ] In `StarMapScene`, render unvisited systems as dim "?" nodes (no name, gray dot). Visited
  systems render normally. OVERMIND systems (Task 23) render in red regardless of visited status.
- [ ] Galaxy generation: assign one home system per faction (5 factions → 5 home systems,
  chosen from non-adjacent starting systems). Home systems have `isFactionHome: boolean` and
  `homeFaction: Faction` on `StarSystem`. Update schemas.
- [ ] Home systems: economy type matches faction (Progressors → INDUSTRIAL; Outlanders →
  AGRICULTURAL; Syndicate → MIXED). Start with higher NPC density (×2 spawn count).
  `QuestGenerator` for home systems emits faction-themed quest names.
- [ ] Unit tests: visitedSystems updated on arrival; home systems assigned deterministically per
  faction; fog-of-war rendering logic (unvisited → no name exposed).

### Task 30: Performance, production build, and ONNX worker isolation

Move `InferenceSession.create()` into the worker thread. System geometry constants go into
`src/config/balance.ts`. Deduplicate `gearToModule` / `KIND_LABEL` into `GearBridge.ts`.

- [ ] Create `src/config/balance.ts` with `SYSTEM_GEOMETRY = { innerRadius: 600,
  outerRadius: 2500, boundaryRadius: 2800, starAvoidRadius: 390, orbitRadii: [...] }` and
  `GAME_BALANCE = { pixelsPerDay: 500, npcSpeed: 0.2, weaponRange: 450, ... }`. Replace all
  hardcoded values in `SpaceFlightScene`, `PlanetGenerator`, `NpcShipSprite`.
- [ ] Create `src/systems/equipment/GearBridge.ts`: export `gearToModule(gear): ShipModule`
  and `KIND_LABEL`, `KIND_COLOR` maps. Remove duplicate copies from `EquipmentShopScene` and
  `StationScene`, replace with imports from GearBridge.
- [ ] Move `InferenceSession.create()` inside the ONNX worker: instead of loading the session in
  `ONNXModelRegistry.loadModel()` on main thread, send the model buffer to the worker via
  `postMessage` with `Transferable`. Worker creates the session and holds it in its own scope.
  Main thread only sends infer requests.
- [ ] Verify `npm run build` produces no TypeScript errors and bundle size < 3MB initial
  (ONNX runtime is loaded lazily). Run `npx tsc --noEmit` + full test suite.
- [ ] Update `MEMORY.md` / project docs: mark all epics as Done in `docs/requirements/README.md`.

---

## Success Criteria

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm test -- --run` — all tests pass (160+ at plan start, target 220+ at completion)
- [ ] `npm run build` — clean production build
- [ ] Player loop works end-to-end: start → trade → buy equipment → accept quest → fly to system
  → complete quest → upgrade ship → fight NPC → text quest → win condition
- [ ] All 9 epics marked Done in `docs/requirements/README.md`
