---
# Combat Shot Legibility: Traveling Tracers (Who Is Shooting Whom)

## Overview
In-flight weapon fire is hard to read — "выстрелы в космосе неявные, непонятно кто в кого стреляет".
Today each shot is a brief **static** 2.5px line from shooter to target that fades over its lifetime;
a static line reads ambiguously (it looks the same in both directions), all NPCs fire the same red,
and there is no cue at the target end. Make fire unmistakable: replace the static beam with a
**tracer bolt that visibly travels shooter→target**, a **muzzle flash at the source** and an
**impact flash at the target**, thicker/brighter and clearly **colour-coded** (player vs enemy), so
direction and attribution read at a glance — including with several combatants firing at once.

## Context
- **Shot rendering:** `src/presentation/flight/CombatHud.ts` — `flashShot(x0,y0,x1,y1,fromPlayer)`
  (~L231) draws `moveTo(x0,y0).lineTo(x1,y1).stroke({color, width:2.5, alpha:0.9})` + a 4px muzzle
  glow at the shooter; `update(dt)` fades each flash over `FLASH_TTL_MS`. Colours:
  `PLAYER_FLASH_COLOR = 0x66ffcc`, `NPC_FLASH_COLOR = 0xff5544` (~L47-48). Flash state is
  `{ g: Graphics; age: number }` on a world-space `flashLayer`.
- **Fire source:** `src/presentation/flight/CombatModule.ts` — `fireNpcShot` (~L256) and the player
  fire path call `hud.flashShot(fromX, fromY, toX, toY, isPlayer)` once per shot at
  `GAME_BALANCE.combatFireIntervalMs`; `DamageNumbers.spawn` already floats a damage number at the
  victim. The module passes correct shooter/target coords — only the **rendering** changes.
- **Layer/lifecycle:** `flashLayer` is a world-space `Container` (zooms/pans with the world),
  `eventMode='none'` (never blocks clicks); `activeFlashCount` is a test/inspection hook.
- **Constraints:** per `feedback-no-blur-filters-flight`, **no per-frame BlurFilters** — build the
  glow from baked/Graphics primitives, not live blur. Presentation-only change; no domain/save touch.
- **Decision (confirmed):** traveling tracer + muzzle/impact flash + colour (not persistent
  engagement lines).

## Development Approach
- **TDD on the deterministic parts** (a tracer is created with the right from/to + colour; its
  position interpolates shooter→target over the travel time; an impact flash spawns on arrival; all
  removed after their TTL; `activeFlashCount` reflects lifecycle). The *look* is verified by a
  **GIF/screenshot** since motion (who→whom) can't be shown in a static frame.
- Run `impact` on `flashShot`/`CombatHud.update` and `CombatModule` fire paths before editing; warn on
  HIGH/CRITICAL. **Do not modify existing test assertions** (standing rule); add new tests. Keep
  `flashShot`'s call signature stable (or extend additively) so `CombatModule` needs no behavioural
  change. No per-frame blur.
- One concern per task; full suite green between tasks.

## Testing Strategy
- Unit: `flashShot` registers a tracer with the correct endpoints + player/enemy colour; `update(dt)`
  interpolates the bolt position from shooter toward target over the travel duration; an impact flash
  is created at the target on arrival; tracer + impact are removed after their TTL; `activeFlashCount`
  tracks the lifecycle; concurrent shots from multiple shooters each render independently.
- Visual (manual GIF): a shot visibly streaks from the firing ship to its target; player fire and
  enemy fire are distinct; with multiple enemies it's clear which one fired.

## Progress Tracking
- `[x]` when done; ➕ new tasks; ⚠️ blockers. Keep in sync.

## Implementation Steps

### Task 1: Traveling tracer bolt + muzzle + impact flash
**Files:**
- Modify: src/presentation/flight/CombatHud.ts (`flashShot` spawns a tracer that interpolates
  shooter→target over a `TRACER_TRAVEL_MS`; muzzle flash at the source; impact flash at the target on
  arrival; extend the flash state with `from/to/age` and a `kind`; `update` advances position then
  fades)
- Create: src/tests/flight/combatTracer.test.ts

- [x] a fired shot renders as a bolt traveling from shooter to target (position interpolates over the
      travel time), with a muzzle flash at the source and an impact flash at the target on arrival;
      no per-frame blur
- [x] write tests: tracer created with correct from/to + colour; position interpolates over travel;
      impact spawns on arrival; all removed after TTL; `activeFlashCount` tracks lifecycle
- [x] run affected tests — must pass before next task

### Task 2: Player/enemy distinction + multi-combatant readability
**Files:**
- Modify: src/presentation/flight/CombatHud.ts (stronger, clearly distinct player vs enemy colour +
  brightness/width so it reads over the star field; ensure concurrent shots from different shooters
  render as independent bolts)
- Modify (only if needed): src/presentation/flight/CombatModule.ts (no logic change — confirm it
  passes the right shooter coords for each combatant)
- Create/Modify: src/tests/flight/combatTracerReadability.test.ts

- [ ] player fire and enemy fire are visually distinct; multiple enemies firing produce separate
      attributable bolts (each from its own shooter position)
- [ ] write tests: player vs enemy colour differs; N concurrent shots → N independent tracers
- [ ] run affected tests — must pass before next task

### Task 3: Verify acceptance criteria
- [ ] verify Overview: shots clearly read shooter→target, colour-coded, with muzzle + impact cues
- [ ] record a GIF of a multi-enemy fight; confirm who-shoots-whom is obvious (motion can't be shown
      in a static screenshot)
- [ ] run full unit suite — all green; `npm run test:e2e:regression`; `npm run lint` clean
- [ ] confirm no existing combat/HUD test assertions changed

## Technical Details
- **Tracer model:** each shot stores `{from:{x,y}, to:{x,y}, age, fromPlayer}`. During `TRACER_TRAVEL_MS`
  the bolt is drawn at `lerp(from, to, age/TRACER_TRAVEL_MS)` (a short streak, not a full-length line),
  so the eye follows the direction of travel; after arrival, a brief impact flash at `to` fades over
  the remaining TTL.
- **Attribution:** colour stays player (`0x66ffcc`) vs enemy (`0xff5544`) but brighter/thicker; the
  muzzle flash anchors the *source* and the impact flash anchors the *target*, removing the
  static-line ambiguity. Each combatant's bolt originates at its own sprite position.
- **Performance:** Graphics primitives only (streak + two small glows); no BlurFilter; bolts are
  cheap and short-lived, on the existing `flashLayer`.

## Post-Completion
**Manual verification (GIF):** start a fight with two or more enemies; confirm each shot visibly
streaks from the firing ship to its target, player vs enemy fire is instantly distinguishable, and
muzzle/impact flashes make the exchange readable.
