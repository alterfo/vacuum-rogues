---
# Living Galaxy Economy — Tech Progression, Artifacts, NPC Roles

## Overview
Build the game loop that carries the player from day 0 to day 500: passive galaxy-wide
research unlocks higher-tier equipment in shops over time; Overmind ships drop artifacts
that can be taken to RESEARCH_LAB stations to upgrade existing gear beyond shop limits;
quest rewards and gear prices are re-balanced so an active player can always afford the
best currently-available equipment; and NPC ships gain meaningful roles (traders doing
trade runs, rangers completing quests, PATROL ships forming military convoys toward
contested systems) to make the galaxy feel alive.

## Context
- `src/systems/equipment/GearCatalog.ts` — items have `techLevel` (1–8) and `basePrice`;
  best hull: tech 7, price 38,000 credits (≈150× a single quest reward → must re-balance)
- `src/systems/equipment/ShopGenerator.ts` — `stockChance` scales with tech, `techMin`
  param already exists; shop refreshes every 7 days with seeded RNG
- `src/presentation/StationScene.ts:183,193` — hardcoded `techMin=3` for RESEARCH_LAB,
  `techMin=1` for everything else; no dynamic galaxy-tech gating
- `src/domain/StarSystem.ts` — **no `techLevel` field yet**; adding it requires schema
  update in `src/validation/schemas.ts` + migration in `src/data/MigrationPipeline.ts`
- `src/domain/Inventory.ts` — `resources: ResourceStack[]` with `ResourceType.ARTIFACTS`
  already defined; artifact pickup is plumbed, just no source
- `src/systems/CombatSystem.ts:491–523` — `resolveVictory` drops gear (30% chance, tech
  ≤ enemy.techLevel+1); no special Overmind branch
- `src/systems/npc/NpcSimulator.ts` — roles RANGER/TRADER/PIRATE/PATROL; `RANGER_QUEST_CHANCE:
  0.1` exists but only sets NPC state to QUESTING without visible world effect;
  no convoy/formation behavior
- `src/types/index.ts:138–144` — `StationType.RESEARCH_LAB` exists
- `src/config/balance.ts` — `STARTING_MONEY: 1000`; quest base 120 + 70/jump (**too low**)
- E2E env: `NO_PROXY=localhost,127.0.0.1`; letsplay harness regenerates screenshots

## Development Approach
- Regression-first: failing test → fix → pass; visual changes need letsplay screenshot
- Domain changes require schema + migration update (CLAUDE.md rule)
- `npm run lint && npm test -- --run` green before each task boundary
- `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` green before done
- No changes to existing test assertions

## Implementation Steps

### Task 1: Galaxy tech level — domain model + daily tick
**Files:**
- Modify: `src/domain/StarSystem.ts`
- Modify: `src/validation/schemas.ts`
- Modify: `src/data/MigrationPipeline.ts`
- Modify: `src/systems/GalaxySimulator.ts` (daily tick)
- Create: `src/tests/galaxy/galaxyTechLevel.test.ts`

- [x] Add `techLevel: number` (default 1, range 1–8) to `StarSystem` domain class and
  initialise to 1 in `GalaxySimulator.generateGalaxy()`
- [x] Update `src/validation/schemas.ts` StarSystem schema: add `techLevel: z.number().int().min(1).max(8).default(1)`
- [x] Add migration in `MigrationPipeline.ts`: old saves without `techLevel` get default 1
- [x] Add `advanceTech(galaxy, day)` in `GalaxySimulator` called from `simulateDay()`:
  every 50 days, each ranger-controlled system with a RESEARCH_LAB station gains +1
  techLevel (cap 8); systems with no RESEARCH_LAB gain +1 every 100 days;
  Overmind/pirate-controlled systems stagnate
- [x] Write unit tests: after 50 days a RESEARCH_LAB system advances from 1→2; after 100
  days a plain system advances; Overmind system stays at 1; cap at 8 enforced
- [x] Run lint + unit tests — green

### Task 2: Dynamic shop gating by system tech level
**Files:**
- Modify: `src/presentation/StationScene.ts`
- Modify: `src/systems/equipment/ShopGenerator.ts`
- Modify: `src/tests/equipment/shopGenerator.test.ts`

- [x] Pass `system.techLevel` into `generateShop()` as `maxTechLevel` param (replaces
  hardcoded `techMin`); items with `techLevel > system.techLevel` are excluded entirely
  (not just low-probability — they don't exist yet in-world)
- [x] Update `StationScene.ts`: remove hardcoded `techMin=3` for RESEARCH_LAB; instead
  pass `starSystem.techLevel` to `generateShop()`; RESEARCH_LAB gets +1 bonus to
  `maxTechLevel` (frontier research premium)
- [x] Write unit tests: shop with system.techLevel=3 never stocks tech-4+ items;
  RESEARCH_LAB system at techLevel=3 can stock up to tech-4; cap at 8
- [x] Run lint + unit tests — green

### Task 3: Economic re-balance — quest rewards and gear prices
**Files:**
- Modify: `src/systems/quests/QuestGenerator.ts`
- Modify: `src/systems/equipment/GearCatalog.ts`
- Modify: `src/config/balance.ts`
- Create: `src/tests/economy/economyBalance.test.ts`

**Target curve (active player, 1 quest per ~12 game days):**
```
Day 100 — ~8 quests done → ~3,000 credits accumulated → afford tech-3 gear (~2,500)
Day 250 — ~20 quests    → ~8,000 credits              → afford tech-5 gear (~6,000)
Day 450 — ~38 quests    → ~15,000 credits             → afford tech-7 gear (~12,000)
```

- [ ] Increase quest base reward: `base = 400`, `perJump = 220`; with 1.0× multiplier
  a 1-jump quest yields ~620 credits; BOUNTY (1.6×) yields ~992 credits
- [ ] Re-price gear in `GearCatalog.ts` so tech tier maps to these credit bands:
  tech 1–2: 500–1,500; tech 3–4: 2,000–5,000; tech 5–6: 5,500–9,000; tech 7–8: 10,000–14,000
  (divide current prices by ~3 across the board, minor per-item tuning)
- [ ] Add `QUEST_BASE_REWARD: 400` and `QUEST_REWARD_PER_JUMP: 220` to `balance.ts`
  (replace magic numbers in QuestGenerator)
- [ ] Write unit tests: generate 40 quests of mixed types and 1–3 jumps, assert mean
  reward is between 550 and 900; tech-7 gear price ≤ 14,000; tech-1 gear price ≤ 1,500
- [ ] Run lint + unit tests — green

### Task 4: Overmind artifact drops from combat
**Files:**
- Modify: `src/systems/CombatSystem.ts`
- Modify: `src/config/balance.ts`
- Modify: `src/tests/combat/combatSystem.test.ts` (or new)

- [ ] Add balance constants: `ARTIFACT_DROP_CHANCE: 0.4` (40% per Overmind kill),
  `ARTIFACT_DROP_COUNT_MIN: 1`, `ARTIFACT_DROP_COUNT_MAX: 3`
- [ ] In `resolveVictory()`: if the destroyed enemy is from an Overmind system (check
  `galaxy.isOvermindSystem(combatContext.systemId)`), roll artifact drop; if hit, add
  `{ type: ResourceType.ARTIFACTS, amount: rng(1, 3) }` to the victory reward's `items`
  array so the existing pickup flow delivers them to `player.inventory.resources`
- [ ] Write RED unit test: mock an Overmind-system combat, call `resolveVictory()` with
  seeded RNG that rolls < 0.4, assert reward includes `ARTIFACTS ≥ 1`; roll ≥ 0.4 →
  no artifacts; non-Overmind system → never artifacts
- [ ] Run lint + unit tests — green

### Task 5: RESEARCH_LAB artifact upgrade system
**Files:**
- Modify: `src/presentation/StationScene.ts`
- Create: `src/presentation/ResearchUpgradePanel.ts`
- Modify: `src/systems/equipment/GearCatalog.ts` (upgrade logic)
- Modify: `src/validation/schemas.ts` (if gear carries upgrade count)
- Create: `src/tests/equipment/artifactUpgrade.test.ts`

**Design:** spending artifacts boosts a gear piece's effective `techLevel` by 1 (max
+2 upgrades per item). An "upgraded" item gets a `upgrades: number` field and
ShopGenerator/display shows it differently. Costs: upgrade 1 → 2 artifacts, upgrade 2
→ 5 artifacts. This lets the player push past the shop ceiling with effort.

- [ ] Add `upgrades?: number` (0–2) to `GearBase`; update schema + migration (default 0)
- [ ] Add `applyArtifactUpgrade(gear, artifacts)` to GearCatalog: validates cost, returns
  new gear object with `upgrades += 1` and `techLevel += 1`
- [ ] Create `ResearchUpgradePanel.ts`: lists player's currently equipped/owned gear,
  shows upgrade cost in artifacts, "Улучшить" button; on confirm calls upgrade logic and
  deducts artifacts from inventory
- [ ] Wire panel into `StationScene.ts`: RESEARCH_LAB service list gains "Исследования"
  entry that opens `ResearchUpgradePanel`
- [ ] Write unit tests: upgrade tech-3 item with 2 artifacts → tech-4, upgrades=1;
  second upgrade costs 5 artifacts → tech-5, upgrades=2; third upgrade rejected;
  insufficient artifacts → error, item unchanged
- [ ] Run lint + unit tests — green
- [ ] Letsplay screenshot: open RESEARCH_LAB → "Исследования" panel visible

### Task 6: NPC purposeful roles — traders, quest-runners, military convoys
**Files:**
- Modify: `src/systems/npc/NpcSimulator.ts`
- Modify: `src/domain/NpcShip.ts`
- Modify: `src/presentation/flight/NpcShipManager.ts`
- Create: `src/tests/npc/npcRoles.test.ts`

**Three behaviors to add:**

**TRADER trade run:** every day, TRADER-role NPCs with IDLE state check neighbouring
systems; if a neighbour has a different economy type, they travel there (TRADING state),
"sell cargo", return. Already in architecture as `cargo` field — just add the goal logic.

**RANGER quest run:** `RANGER_QUEST_CHANCE: 0.1` already sets QUESTING state — now make
it visible: QUESTING ranger picks a target planet in the system (or adjacent system),
travels there, then returns to idle. In InfoCenter, active quests show "взято рейнджером"
if an NPC claimed it first.

**PATROL military convoy:** every 30 days, check for contested border systems
(Overmind/pirate adjacent to ranger-controlled systems); if found, pick 2–3 PATROL NPCs
from the nearest friendly systems and set them all to `destinationSystemId = contested`
with same `daysToArrival`; they appear as a formation in SpaceFlightScene; on arrival,
simulate a battle (contested system has 20% chance of liberation per convoy).

- [ ] Add `convoyId?: string` to `NpcShip` so ships in the same convoy share an ID;
  update schema + migration
- [ ] Implement TRADER trade-run goal selection in `NpcSimulator.simulateDay()`:
  IDLE TRADER with no cargo → pick economy-different neighbour → TRAVELING
- [ ] Implement PATROL convoy assembly: `assembleConvoy(galaxy, rng)` called every 30 days;
  picks contested border, selects 2–3 idle PATROL ships from adjacent friendly systems,
  assigns shared convoyId and same destination
- [ ] In `NpcShipManager.ts`: ships sharing a convoyId fly in a loose V-formation offset
  (±30px perpendicular to heading) rather than exact same position
- [ ] Write unit tests: after 1 day TRADER in IDLE with cargo picks trade destination;
  after 30 days assembleConvoy produces ≥1 convoy with convoyId set on all members;
  convoy members have same destinationSystemId; NpcShipManager formation offset differs
  between convoy members
- [ ] Run lint + unit tests — green
- [ ] Letsplay screenshot: visible NPC formation in flight scene

### Task 7: Verify acceptance criteria
**Files:** all modified files above

- [ ] Economic curve: run `tools/galaxy-sim/model.ipynb` with new reward numbers; confirm
  day-300 accumulated credits ≥ tech-5 gear price; day-500 ≥ tech-7 gear price
- [ ] Tech progression: start new game, advance simulated days in unit test; confirm
  system techLevel reaches 5 by day 250 in a RESEARCH_LAB system
- [ ] Artifact loop: kill Overmind ship → pick up artifacts → travel to RESEARCH_LAB →
  upgrade gear → gear shows tech+1
- [ ] NPC roles: at game start open flight scene, confirm 3+ visible ship types;
  within 30 game days, at least 1 PATROL convoy visible on galaxy map
- [ ] Run full unit test suite: `npm test -- --run` — green
- [ ] Run `NO_PROXY=localhost,127.0.0.1 npm run test:e2e:regression` — green
- [ ] Run `npm run lint` — zero errors

### Task 8: [Final] Update balance documentation
**Files:**
- Modify: `tools/galaxy-sim/model.ipynb`
- Modify: `src/config/balance.ts` (inline comments)

- [ ] Update notebook with new reward values to confirm model matches intent
- [ ] Add comments to balance.ts constants explaining the target day-curve
- [ ] Update ENTITIES_AND_MODULES.md if new fields added to domain

## Technical Details

**Credit accumulation target curve:**
```
Active player = 1 completed quest per 12 game days (travel ~5 days + buffer)
Quest mix: 60% 1-hop, 30% 2-hop, 10% 3-hop; 50% DELIVERY, 30% BOUNTY, 20% other

Day 100 → ~8 quests → avg ~680 credits each → ~6,400 earned + 1,000 start = 7,400
Day 250 → ~20 quests → 15,600 earned total
Day 450 → ~37 quests → 26,000 earned total (+ artifact sale / combat loot ~4,000)
```

**Gear price tiers (new):**
```
Tech 1–2  (day 0+):   500 – 1,500 credits   [starter gear]
Tech 3–4  (day 50+):  2,000 – 5,000 credits  [mid gear]
Tech 5–6  (day 150+): 5,500 – 9,000 credits  [advanced gear]
Tech 7–8  (day 350+): 10,000 – 14,000 credits [endgame gear]
```

**Tech advancement schedule (researcher lab system):**
```
Day 0:   techLevel = 1 (all systems start here)
Day 50:  techLevel = 2
Day 100: techLevel = 3
Day 150: techLevel = 4  (non-research-lab systems reach 3 by now)
Day 250: techLevel = 5
Day 350: techLevel = 6
Day 450: techLevel = 7
Day 500: techLevel = 8
```

**Artifact upgrade costs:**
```
+1 upgrade (e.g. tech 3 → tech 4): 2 artifacts
+2 upgrade (e.g. tech 4 → tech 5): 5 artifacts total (3 more)
Maximum: 2 upgrades per gear piece
```

**Convoy assembly rule:**
```
Every 30 days: find all systems where pirate/overmind borders a ranger system
For each contested border: take up to 3 PATROL NPCs from the friendly side
  → assign convoyId = `convoy_${day}_${systemId}`
  → all travel together (same daysToArrival)
  → on arrival: 20% liberation chance per convoy (applied in simulateDay)
```

**TRADER trade logic:**
```
TRADER idle → scan neighbours for economy type != own system economy
→ if found: go TRAVELING to that system, set cargo = [{ goodId: 'MIXED', qty: 5 }]
→ on arrival: go TRADING for 1 day, earn 'credits += techLevel * 30'
→ return to origin system
```

## Post-Completion

**Manual verification:**
- Start fresh game, play ~30 in-game days: shops should only show tech 1–2 gear
- Kill Overmind ship: artifacts should appear in cargo
- Fly to RESEARCH_LAB: Исследования service visible; spend artifacts on upgrade
- Day 100 (speed up via game speed): tech 3 gear appears in shops near RESEARCH_LAB
- Watch galaxy map: NPC convoys visible moving toward contested systems

**Future work (out of scope):**
- Faction-specific tech trees (Overmind gets tech faster in controlled systems)
- Artifacts as trade goods (sell for credits, not just upgrade)
- Player can join a convoy as escort (ties into escort quest refactor)
- Research events: rare "breakthrough" that jumps a system +2 tech instantly
