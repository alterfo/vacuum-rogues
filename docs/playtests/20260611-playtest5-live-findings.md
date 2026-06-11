# Playtest 5 — Live Findings (2026-06-11, during overmind-balance ralphex run)

Findings from continued playtest. Code untouched while ralphex runs the
overmind-equilibrium plan on this branch (its gates run `npm test`/`build`, so
uncommitted edits would break them). Fix in a batch after that run completes.

## Findings

### A — Planet backdrops all look the same (ROOT CAUSE FOUND)
"фон у планет одинаковый какой-то". The PlanetScene panorama is chosen **only
by the system's `ownerFaction`** (`panoramaKeyForFaction(initSystem.ownerFaction
?? "INDEPENDENT")`, `PlanetScene.ts:175,252`), with fallback `outlanders_city`.
So every planet in an INDEPENDENT system → the same `wilderness_jungle`, and any
unmapped faction → the same `outlanders_city`. Neither the **planet type** (gas
giant / ice / desert / habitable) nor the **planet id** participates — there are
8 panorama assets (5 faction cities + `wilderness_desert/jungle/tundra`) but only
one per faction is ever used.

**Fix direction:** key the backdrop by planet TYPE first (desert/rocky → desert,
habitable-wild → jungle, ice → tundra), faction-capital/habitable-owned → that
faction's city, and use `pickVariant("panoramas", <prefix>, planet.id)` so
same-type planets still vary deterministically when multiple variants exist.
Verify in letsplay: land on several different planet types → distinct backdrops.
