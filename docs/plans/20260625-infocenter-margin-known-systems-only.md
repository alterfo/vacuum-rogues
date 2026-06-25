---
# InfoCenter: Show Trade Margins Only for Known Systems

## Overview
The InfoCenter shows trade-route / rumor **margins** for systems the player hasn't
discovered — you "know" the profit of a route into a system you've never seen, which
breaks the partial-observability the game (and the human-like agent) should respect.
Fix: a margin is shown **only when the system(s) it depends on are known** (explored via
the star-map or visited); for an unknown system, mask the margin (the rumor/location can
still show, but not the number).

## Context (from discovery)
- **"Known" signals already exist:** `Player.visitedSystems` + `Player.hasVisited(id)`;
  `Galaxy` marks `system.explored = true` on star-map reveal (`revealSystem` /
  `revealWithinHops`). So **known = `system.explored || player.hasVisited(id)`**.
- **InfoCenter (`src/presentation/InfoCenterScene.ts`):** renders rumor/route hits via
  `buildRumorPanel` (`./rumorPanel`), mapping `systemId → name` and showing margins.
- **Margins (`src/systems/trade/RouteScanner.ts`):** `marginPct` / `RouteRumor` carry the
  buy/sell systems + margin; a route has two endpoints — the margin is "known" only if
  **both** endpoints are known.

## Development Approach
- **Testing approach: TDD.** A pure `isSystemKnown(player, galaxy, id)` predicate +
  the masking decision (margin shown iff all involved systems known) are unit-tested;
  the panel render is a content assertion. `impact` on `buildRumorPanel` /
  InfoCenter render first.
- Presentation/visibility only — no domain/schema/save change; the data still exists,
  it's just not surfaced for unknown systems.

## Implementation Steps

### Task 1: `isSystemKnown` predicate
**Files:**
- Create: `src/systems/galaxy/systemKnown.ts` (+ test) — or co-locate near `Player`/`Galaxy`

- [x] `isSystemKnown(player, galaxy, systemId)` → `system.explored || player.hasVisited(id)`.
- [x] write tests: explored-only true; visited-only true; neither false; unknown id false.
- [x] run tests — green.

### Task 2: Mask the margin for unknown systems in the InfoCenter
**Files:**
- Modify: `src/presentation/InfoCenterScene.ts` / `src/presentation/rumorPanel.ts`

- [x] When rendering a route/rumor margin, show the number **only if every system the
      margin depends on is known**; otherwise hide the margin (e.g. «—» / omit it / "?"),
      keeping the rest of the row. Known systems are unchanged.
- [x] write tests: a rumor whose endpoint is unknown renders without a margin; one whose
      endpoints are all known renders the margin.
- [x] run tests — green.

### Task 3: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [ ] `detect_changes` — InfoCenter/rumorPanel + the predicate affected; no schema.
- [ ] full unit suite green; `npm run test:playtest` green; lint/build ok.

### Task 4: Update documentation
**Files:**
- Modify: `src/presentation/CLAUDE.md` (InfoCenter note)

- [ ] Note that InfoCenter margins respect partial observability — shown only for known
      (explored/visited) systems.

## Post-Completion
**Manual:** in the InfoCenter, routes touching unexplored systems show no margin; once
you explore/visit a system, its margins appear.
