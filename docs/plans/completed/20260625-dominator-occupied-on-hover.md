---
# Show "Occupied by Dominators" on Planet Hover (Not Just on Landing)

## Overview
When a planet is captured by the OVERMIND ("Dominators"), the player only learns
they can't land **after attempting to land** (the denial toast fires on the land
action). That's a wasted trip. Surface the same information **on hover** — the
planet's flight tooltip should already say it's occupied / un-landable, so the
player can decide before flying there.

## Context (from discovery)
- **Landing rule (pure):** `src/systems/galaxy/landingAccess.ts` —
  `canLandOnPlanet(...)` returns `{allowed, reason?}`; `reason` is
  `"overmind" | "pirate-rep"`; `landingDenialMessage(reason)` is the
  human-readable string. `OVERMIND_FACTION_ID = Faction.OVERMIND`.
- **Flight tooltip + denial seam (`src/presentation/flight/PlanetManager.ts`):**
  `showPlanetTooltip(planet, faction, x, y)` renders the hover tooltip (delegated
  to the HUD); `landingDenial(planet): LandingDenialReason | null` already wraps
  `canLandOnPlanet` for the land-attempt path. The hover and the land-attempt both
  have access to the same `landingDenial`, but only the land path surfaces it.
- The HUD owns the tooltip rendering (`PlanetManagerDeps.showPlanetTooltip` →
  scene HUD) — the denial line must be threaded into the tooltip content.

## Development Approach
- **Testing approach: TDD.** `landingDenial` is already pure/tested; the new work
  is (a) passing the denial reason into the tooltip payload and (b) the HUD
  rendering a clear line. Keep `landingDenialMessage` as the single source of the
  wording (hover + land path show the *same* text — no second copy).
- Additive, presentation-only. No domain/schema/save change. `impact` on
  `showPlanetTooltip` before editing (HUD is the only consumer).

## Testing Strategy
- **Unit:** the tooltip-content builder includes the denial line when
  `landingDenial(planet)` is non-null (overmind + pirate-rep), and omits it when
  landing is allowed. Reuse `landingDenialMessage` (assert the same string).
- **E2E/manual:** hovering an OVERMIND-captured planet shows "occupied" in the
  tooltip; hovering a normal planet does not.

## Implementation Steps

### Task 1: Thread the landing-denial reason into the hover tooltip
**Files:**
- Modify: `src/presentation/flight/PlanetManager.ts`
- Modify: the HUD tooltip renderer (the `showPlanetTooltip` implementation, e.g. `src/presentation/flight/FlightHud.ts`)

- [x] In the hover path, compute `landingDenial(planet)` and pass the resulting
      reason (or its `landingDenialMessage`) into the tooltip payload alongside the
      existing planet/faction info.
- [x] Render a clear, color-coded "occupied / cannot land" line in the tooltip
      (e.g. red «Захвачена Доминаторами — посадка невозможна») using the SAME
      `landingDenialMessage(reason)` text the land-attempt uses.
- [x] write tests: tooltip content includes the denial line iff `landingDenial`
      is non-null (overmind + pirate-rep cases) and is absent when landing is
      allowed.
- [x] run tests — green.

### Task 2: Verify acceptance criteria
**Files:**
- Modify: (none — verification only)

- [x] `detect_changes({scope:"compare", base_ref:"master"})` — source scope: only
      PlanetManager.ts, FlightHud.ts (HUD tooltip), the existing shared
      `utils/planetTooltip.ts` content builder (extended with the optional
      `landingDenial` param + the red occupied line), and SpaceFlightScene.ts
      wiring (+ the new test) — the planned seam. (The feature commit a9ecfd1 also
      swept in unrelated gitnexus skill / AGENTS.md doc churn — doc-only, no code.)
- [x] full unit suite green (3059 passed); `npm run test:playtest` green (67
      passed); `npm run lint` clean (0 errors); `npm run build` ok.

### Task 3: Update documentation
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` or `playtest-traps.md`

- [x] Note that the planet hover tooltip surfaces the landing-denial reason
      (shared wording with the land-attempt via `landingDenialMessage`).

## Post-Completion
**Manual verification:** hover an OVERMIND-captured planet → tooltip shows it's
occupied / un-landable before any landing attempt; a normal planet's tooltip is
unchanged.
