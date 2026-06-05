# EPIC-009: Information System (Galactic Registry & Search)

> Canon: [SOURCE-OF-TRUTH §11.5 "Info center"](../reference/SOURCE-OF-TRUTH.md#11-дайджест-механик-планет-кораблей-и-станций)
> (look up object locations; news feed) and
> [§11.3 "Equipment shop"](../reference/SOURCE-OF-TRUTH.md#11-дайджест-механик-планет-кораблей-и-станций)
> (equipment/weapon parameters, tech levels, quality).

## Description
A cross-cutting **galactic information system** — what the original info center
provided, but as a full service rather than a single button. Two parts:

1. **Registry** — a "who/what/where" index: locations of significant ships
   (NPC captains, EPIC-003), planets/stations and their services, and the
   **equipment/weapon shop inventory** across systems.
2. **Parameter search** — queries over the registry: "where to buy the best hull
   for a combat build", "on which planet is a weapon with damage ≥ X and range ≥ Y
   cheapest", "nearest crafting station", "where did ship Z fly off to".

The planet info center (EPIC-006, US-065) is the **front-end** to this service:
news feed + a search form. The registry is updated by the simulation (markets
EPIC-001, NPC movement EPIC-003, inventory EPIC-007).

## Business Value
Makes a large galaxy **navigable and meaningful**: the player decides where to
fly for an upgrade, where it is cheaper, whom to intercept — from data, not
blindly. It strengthens the loop "earned money → want a better hull/weapon → the
system tells me where it is → fly halfway across the galaxy". It removes the
"I don't know where anything is sold" frustration in a world of dozens of systems.

## User Stories

| ID | Title | Status |
|----|-------|--------|
| US-090 | Object registry: index of planet/ship/market/gear locations by system | In Progress (`GalacticRegistry` + `InfoService.buildRegistry` facade; station services pending) |
| US-091 | Ship registry: where each significant NPC ship is now — EPIC-003 | **Done** (`findShip`/`shipsInSystem`/`findShips`, tests) |
| US-092 | Inventory index: goods + **gear** (hulls/weapons/equipment) and prices per system | **Done** (market goods + `GearListing` via `ShopGenerator`; tests) |
| US-093 | Parameter search: filter goods/gear (kind, tech, size, price, hp/slots/damage/range), ranked | **Done** (`findResource`/`findGear`, tests) |
| US-094 | "Best buy" query: cheapest/best place for X, sorted, with **jump distance** | **Done** (`cheapestResource`/`bestGear`, tests) |
| US-095 | News feed: simulation events (prices, OVERMIND, pirates/traders) with bookmarking | Planned |
| US-096 | Info center gated by reputation/service; registry accuracy degrades with distance/staleness | Planned |
| US-097 | Info center screen: tabs "News / Object search / Shops & gear" (UI over the service) | Planned |

## Acceptance Criteria (Epic Level)
- [ ] A **registry service** (pure logic) that knows: the current system of every
      significant NPC ship, planet/station services, and shop inventory.
- [ ] The registry is **updated by the simulation**: NPC movement (EPIC-003),
      market changes (EPIC-001) and gear inventory (EPIC-007) are reflected.
- [ ] **Parameter search** returns a sorted list: for weapons by
      damage/range/price/tech level; for hulls by HP/slots/price; each with the
      **system and the jump distance** from the player's current position.
- [ ] The "best X for criterion" query returns the top result and a route (jump
      count), using the hyperjump graph.
- [ ] The news feed aggregates simulation events; a news item can be bookmarked.
- [ ] Access/completeness is **gated**: the info center is unavailable at hostile
      reputation; data for distant/long-unvisited systems is incomplete/stale.
- [ ] The registry and bookmarks are persisted in the save.
- [ ] The registry service and queries are covered by unit tests (deterministic world).

## Design: data model and queries
- **Registry** — a derived view over `Galaxy`/`Market`/`NpcShip`/gear inventory
  (EPIC-007), rebuilt incrementally on day events; it does not duplicate state but
  indexes it for fast queries.
- **Query** — a `{ kind, filters, sort, origin }` structure:
  - `kind`: `EQUIPMENT | WEAPON | HULL | SHIP | SERVICE`.
  - `filters`: parameter ranges (e.g. `damage>=X`, `techLevel in [T4..T8]`,
    `price<=C`, `size<=S`).
  - `sort`: by a parameter or by distance (jump count).
  - `origin`: the player's current system (for jump distance).
- **Distance** is computed over the hyperjump graph (as `WarpPath`/`StarMapScene`).
- **Data fog** (deliberate gameplay): the farther / longer-unvisited a system, the
  less accurate its price/availability/location — this rewards scouting and news.

Example: "a combat hull with HP ≥ 200 and ≥ 3 weapon slots, under 50k, within 4
jumps" → a list of systems sorted by price and jumps.

## Dependencies
- EPIC-003 (living galaxy) — source of NPC location/routes.
- EPIC-001 (markets) — prices/availability of goods and gear.
- EPIC-007 (fitting) — hull/weapon/equipment parameters for filters.
- EPIC-006 (planet hub) — the info center as the entry point (US-065 = front-end).
- EPIC-004 (map/radar) — reuse of the jump graph for distances.

## Affected Components (plan)
- `src/systems/info/GalacticRegistry.ts` (new) — index of objects/services/inventory.
- `src/systems/info/InfoQuery.ts` (new) — query model + execution (filter/sort/jumps).
- `src/systems/GalaxySimulator.ts` — publish registry-update events per day.
- `src/presentation/InfoCenterScene.ts` (new) — tabs "News / Search / Shops".
- `src/domain/` — planet/station service and inventory types (ties into EPIC-007).
- `src/validation/schemas.ts`, `src/data/MigrationPipeline.ts` — persist registry/bookmarks.

## Deliberate Deviations from Canon
- The original info center was an object lookup; we add **structured parameter
  search over gear** and jump-distance computation (a gameplay extension that does
  not contradict canon).
- "Data fog" (inaccuracy for distant systems) is our design device.

## Implementation Plan
Slices tracked in `DEVELOPMENT_PLAN.md` as **Feature 14**. Order: US-090/092
(object & inventory index — a pure index, tests without UI) → US-093/094
(parameter search + "best gear" with jumps) → US-091 (NPC tracking, needs
EPIC-003) → US-095 (news) → US-097 (info center screen, needs EPIC-006) → US-096
(gating/data fog) → persistence.
