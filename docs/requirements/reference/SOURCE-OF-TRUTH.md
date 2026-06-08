# Source of Truth: Game Design Document

> **This is the canonical document.** All requirements (epics, user stories) and game mechanics derive from here. If any requirement or code conflicts with this description — this document wins.
>
> **Copyright note.** Mechanics and structure are inspired by the original Space Rangers series, but all faction names, rank names, hull series names, and station type names are original. Original IP names are NOT used in any game asset or code.

---

## §1 Genre and Core

A space RPG/strategy with an open world. The player is a free captain who moves across the galaxy: trading, taking quests, exploring, fighting, upgrading their ship. The global objective is to resist a galactic-scale threat — the **OVERMIND**.

---

## §2 Galaxy Structure

- The galaxy is divided into **sectors**; each sector contains **star systems**.
- The galaxy map is **generated at new game start** (partially random, partially rule-based) — deterministic from seed.
- Between systems: **hyperjumps** (fast transitions; cost fuel and game days).
- A system = **a star at the centre + planets in orbit** (habitable and uninhabitable).

---

## §3 In-System Flight

- **Top-down view (2D).**
- **Turn-based by game days**: one turn ≈ one game day. The player issues orders (heading, weapon target), ends turn, action plays out. World is static while planning; days and movement happen during flight.
- The system is **larger than the screen**; the full system is visible on the **minimap radar**.
- Other ships are present simultaneously (see §6), shown as coloured markers by faction affiliation.
- At the edge of the system — **the jump boundary**, from which a hyperjump is performed.

---

## §4 Economy and Trade

- Single currency — **galactic credit**.
- On planets/stations: trade in goods and trophies, purchase equipment, accept quests, news, repair.
- Prices depend on **supply/demand** and **reputation with the faction**; there are legal and illegal goods (contraband → fines/reputation penalty).

---

## §5 Factions

> Ordered by technology level (lowest → highest). English IDs are used in code.

| Tech | Code | Russian Name | Character | Gameplay Bonuses |
|------|------|-------------|-----------|-----------------|
| Low | `BASTIONS` | **Бастионы** | Militarists; cult of strength; large, powerful | High damage, heavy armour, military tech |
| Low-Med | `SYNDICATE` | **Синдикат** | Pirates, smugglers, spies; cunning and quick | Stealth, speed, black market access |
| Medium | `OUTLANDERS` | **Окраинники** | Colonists, traders, diplomats; versatile | Trade bonuses, repair, reliability |
| High | `PROGRESSORS` | **Прогрессоры** | Researchers, innovators, intellectuals; physically frail | Advanced tech, drones, science modules |
| Maximum | `PARADOXES` | **Парадоксы** | Enigmatic; highest tech; unpredictable | Unique modules unavailable elsewhere |

- Plus **independent/pirates** (`INDEPENDENT`) and **the threat** (`OVERMIND` — ancient civilisation, final antagonist).
- **Reputation** with each faction affects attitude, prices, and access to services.

---

## §6 Living Universe (key principle)

The world lives **independently of the player**:

- **NPC captains** fly between systems, take and complete quests, trade, level up, fight.
- **Pirates** raid trading ships; **patrols** chase them.
- **Traders** carry goods between systems, affecting markets.
- **Global events** happen: system conquests, coups, invasions.
- The player is just one of many actors, not the centre of the world.

→ In our project this is **EPIC-003 "Living Galaxy"**.

---

## §7 Ship, Equipment, Combat

- The **hull** determines the number of equipment slots and structural HP; the **cargo hold** — capacity.
- **Equipment** has quality levels and manufacturers (by faction). Higher-tech faction = more expensive but more durable.
- **Repair** of the hull and refuelling — at planets/stations.
- **Space combat** between ships in-system.
- **Planetary battles** — separate mode (low priority, deferred).

### 7.1 Hull Series (8 tiers, our names)

| Tier | Our Name | Type Bias | Slots | HP |
|------|----------|-----------|-------|-----|
| T1 | Lightweight | Scout | 2–3 | Low |
| T2 | Standard | All-rounder | 3–4 | Medium |
| T3 | Reinforced | Fighter | 4–5 | Medium-High |
| T4 | Heavy | Transport / Cruiser | 4–6 | High |
| T5 | Advanced | All-rounder | 5–6 | High |
| T6 | Elite | Combat | 6–7 | Very High |
| T7 | Prototype | Any | 6–8 | Very High |
| T8 | Legendary | Any | 7–9 | Maximum |

Hull HP = hull volume (size units). Damage formula: `dmg = shot_power × (1 - shield%) - armour_bonus`.

### 7.2 Standard Equipment Slots

| Slot | Code | Key Parameter |
|------|------|---------------|
| Engine | `ENGINE` | Speed, maneuverability |
| Fuel tank | `FUEL_TANK` | Capacity, jump range |
| Radar | `RADAR` | Detection radius |
| Scanner | `SCANNER` | Enemy equipment reveal depth |
| Repair droid | `REPAIR_DROID` | In-flight HP/day |
| Cargo hook/grabber | `GRABBER` | Debris/cargo pickup |
| Shield generator | `SHIELD_GEN` | Shield HP |
| Weapon | `WEAPON` | Damage, range, type |

### 7.3 Weapons

| Type | Code | Principle | Advantage |
|------|------|-----------|-----------|
| Energy | `ENERGY` | Beam/laser | Accurate, instant |
| Kinetic | `KINETIC` | Shells/projectiles | Good vs armour |
| Missile | `MISSILE` | Homing | Long range |

### 7.4 Micromodules

- 3 power levels: `MM1` (strongest bonus per slot), `MM2`, `MM3`.
- Modifies one parameter of one item; **cannot be removed after installation**.
- Sources: craft stations, planet exploration rewards, quest rewards, combat trophies.
- Some micromodules are faction-locked.

---

## §8 Quests and Reputation

- Quests are issued by **planet governments and other entities**.
- Types: delivery (`DELIVERY`), bounty (`BOUNTY`), escort (`ESCORT`), diplomacy (`DIPLOMACY`), exploration (`EXPLORATION`).
- Completion → reward (credits/items) and **reputation change**.
- Quests have **deadlines** (in game days).
- **Text quests** — a signature feature: quest-novel with branching choices; outcome depends on choice (and stats/resources). Enhanced by a **local ONNX dialogue model** (EPIC-005): situations and lines are generated, not just selected from fixed variants. This is the project's key differentiator.

---

## §9 Component Map

| Mechanic | Where in our code |
|----------|------------------|
| Galaxy, systems, hyperjumps | `Galaxy`, `StarSystem`, `WarpPath`, `StarMapScene` |
| In-system flight (top-down, turns) | `SpaceFlightScene`, `Galaxy.gameDays` |
| Minimap radar | `SystemMiniMap` (EPIC-004) |
| Large system scale | `PlanetGenerator.ORBITAL_RADII` (EPIC-004) |
| Trade / market | `TradeSystem`, `Market`, `TradeScene` (EPIC-001) |
| Combat | `CombatSystem`, `TacticalEncounter`, `CombatScene` (EPIC-002) |
| Factions / reputation | `FactionRegistry`, `Faction`, `Player.reputation` |
| Living universe (NPC) | `NpcShip`, `NpcSimulator`, `NpcBrain` (EPIC-003) |
| Quests | `QuestManager`, `Quest`, `QuestDirector` |
| Dialogues / NPC on planets | `DialogueSystem`, `NPC`, `DialogueScene` |
| Text quests (ONNX) | `TextQuestEngine`, `ONNXModelRegistry` (EPIC-005) |
| Game title / branding | `GameConfig.GAME_TITLE` = "Вакуумные Пройдохи" |

---

## §10 Technical Specifics

- **Platform**: browser, PixiJS 8, local ONNX models for dialogue/AI.
- **Hyperjumps**: not instant — cost fuel and time.
- **Turn-based**: world pauses while planning; days run during flight.
- **Planetary battles**: low priority / deferred.
- **OVERMIND** — ancient threat (final boss).
- **Save system**: IndexedDB, Zod validation, migration pipeline.

---

## §11 Planet Hub: Service Digest

> Derived from the reference manual in our own words. No proprietary names transferred.

### 11.1 Planet Screen (service hub)

- After landing: planet view + info panel: faction-owner, political system, economy type, population, **player attitude**.
- **Population** influences goods and equipment range.
- **Economy type** sets price tiers: agrarian (cheap food/medicine/alcohol), industrial (cheap tech/luxury), mixed (average).
- **Political system** (anarchy/dictatorship/monarchy/republic/democracy) sets **legality** of some goods (contraband: drugs/alcohol/etc.).
- **Attitude/reputation** gates services: poor attitude → no trading/buying/infocenter access; government special quests → only with good reputation.
- Hub buttons: Trade Centre, Equipment Shop, Hangar, Info Centre, Government (dialogue), Take Off.

### 11.2 Trade Centre

- ~8 commodity groups (food, medicine, equipment, luxury, minerals, alcohol, weapons, contraband). Buy/sell; value indicators (↑/↓).
- Constraints: cannot buy more than available credits or free hold capacity.
- Sell price on the same planet always lower than buy price (see US-006); profit comes from inter-system transport.

### 11.3 Equipment Shop and Ship Fitting

- Standard equipment and weapons for sale. Range depends on faction and tech level; price depends on parameters, **size**, and **quality** (smaller + higher quality = more expensive).
- **Hull = ship**: capacity (= HP) + number of slots (open/closed). Hull **series** (~8 tiers, T1–T8).
- Ship type (combat/trade/…) defines the number of weapon and other slots.
- Micromodules: see §7.4.

### 11.4 Hangar (repair / refuel / launch)

- Robot assistant shows status of key components (hull/engine/tanks): "System check: … Ship ready for launch."
- Actions: repair hull (if damaged), refuel (if tank not full), launch.
- **Cannot launch without engine and fuel tanks.**

### 11.5 Info Centre

- Galaxy news feed (price drops, system liberations from OVERMIND, pirate/trader appearances, events). Can bookmark a news item.
- Search for any significant object's location (ship/planet/station/equipment in shop).

### 11.6 Space Stations

Unlike planets, stations are **fixed in space** (can fire at attackers or flee). Same services as planets but each type has its speciality.

| Our Name | Code | Key Specialty |
|----------|------|---------------|
| Craft Centre | `CRAFT_STATION` | Micromodule fabrication, node collection, ranger classification |
| Research Base | `RESEARCH_BASE` | OVERMIND research, probe manufacture, one-time equipment upgrade |
| Military Base | `MILITARY_BASE` | Ranks / rank rewards, best weapon sales, combat briefings |
| Pirate Base | `PIRATE_BASE` | All goods incl. contraband; used equipment; identity change |
| Medical Station | `MEDICAL_STATION` | Illness diagnosis/treatment, temporary bio stimulants |
| Trade Hub | `TRADE_HUB` | Credits, investments, insurance, trade optimisation research |

### 11.7 NPC Interaction in Space

- **Conversation**: traders report origin/destination and price levels; pirates/rangers — advice/threats by attitude. Options: trade, intimidate (take money/cargo), form alliance, **hire a ranger as companion**.
- **Scanning**: scanner vs target's shield → reveals installed equipment/weapons (important pre-combat); depends on radar range.

### 11.8 Ranks and Progression

Ship kills award combat points; reaching a threshold → new rank at a Military Base; score resets after promotion. Rank ladder (our names, low → high):

| Rank | Code | Points to Reach |
|------|------|----------------|
| Rookie | `RANK_ROOKIE` | Start |
| Cadet | `RANK_CADET` | +100 |
| Pilot | `RANK_PILOT` | +250 |
| Captain | `RANK_CAPTAIN` | +450 |
| Fighter | `RANK_FIGHTER` | +750 |
| Ace | `RANK_ACE` | +1000 |
| Commander | `RANK_COMMANDER` | +1500 |
| Admiral | `RANK_ADMIRAL` | +2000 |

Kill point awards (reference-calibrated, our values):
- Small fast ship: 1 pt · Medium warship: 12 pt · Heavy cruiser: 24–48 pt
- Liberate system from OVERMIND: +30 pt · Pirate: +10 pt

### 11.9 Text Quests (see EPIC-005)

"Living book" with branching choices; two categories: logical (puzzle/task) and atmospheric (immersive vignette). Enhanced by ONNX narrator: situations and NPC lines are generated, not just selected from fixed variants.

---

## §12 Sources

> Mechanics and ideas in our own words; no proprietary names from the original game are used in any code, asset, or player-facing text. The reference manual is stored locally outside the repo (`reference/help/`, in `.gitignore`).
