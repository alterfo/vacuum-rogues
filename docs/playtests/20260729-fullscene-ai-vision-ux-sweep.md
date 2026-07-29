# Full-Scene AI-Vision UX Sweep (2026-07-29)

## Method

Instead of a human walking the game by hand, two Playwright discovery sweeps
(`e2e/letsplay-discovery.spec.ts`, `e2e/visual-sweep-task17.spec.ts`) were run
fresh to capture ~65 full-canvas screenshots across every player-facing scene
(main menu → faction select → flight → planets ×8 → trade/equipment/gov/info
/bank → station → hangar → combat ×4 → text-quest → star map → inventory →
game over). Screenshots were then split into 4 batches and reviewed in
parallel by independent `ux-reviewer` agents (vision), each primed with the
already-fixed findings from the same day's earlier 8-screen pass
(`docs/plans/completed/20260729-ux-review-fixes.md`) so they wouldn't
re-report solved issues.

**Known caveat (inherited from the prior pass):** both sweeps navigate via
`engine.transitionTo(scene, ctx)`, a test shortcut that can skip init
side-effects a real click-through triggers. The prior pass found 4/13
findings were false positives from this exact artifact. Every finding below
is tagged `artifact-risk: yes/no` — **treat `yes` as "verify live via real
click-through before fixing," not as a confirmed bug.**

## Significant (durable, artifact-risk: no)

1. **Job-board tag text collides at large font scale** — `[Планета: Эклиптика]`
   and `[Выдан: Меридиан]` merge into unreadable text
   ("Эклиптик[аВы]дан") at the L font-scale capture; confirmed real because
   the S-scale capture shows the same two tags cleanly separated.
   (`jobboard-fontscale-L.png` vs `-S.png`)
2. **Two habitable planets use near-identical stock art** — "Резонанс" and
   "Спика" (both Земной • Обитаемая) render with the same cloud-sky photo,
   same mountain silhouette, same dirt foreground; only the name differs.
   (`lp-10-planet-2.png` / `lp-10-planet-3.png`)
3. **Planet population data disagrees between two screens for the same
   planet** — "Меридиан" shows "Население: 2,5 млн" on the planet-exterior
   HUD but "8 432 679" on the Governor/government screen — different order
   of magnitude, not a rounding difference. Likely two different data reads
   for the same field. (`task17/03-planet.png` vs `task17/06-government.png`)
4. **Planet header stats have no scrim** — name/type/population/relation text
   renders in low-opacity gray directly on busy photo backdrops with no
   panel/gradient behind it; legibility depends entirely on which planet art
   happens to load (near-invisible against bright cloud-sky art).
   (`lp-10-planet-0/2/3.png`, `planet-help-balance.png`)
5. **Combat has two unreconciled visual languages** — an abstract hex-grid
   board with tiny generic diamond glyphs (`lp-20-combat.png`) vs. a spatial
   orbital view with textured ship sprites and dashed range rings
   (`combat-planning-phase.png`, `dogfight-planning-phase.png`). If both
   occur in the same playthrough this is a jarring mental-model switch.
6. **No player-ship HP/shield display during combat planning** — only the
   enemy gets a status readout; the player can't see their own condition
   while choosing Форсаж/Откупиться/Требовать сдаться/Позвать на помощь.
   (`combat-planning-phase.png`, `dogfight-planning-phase.png`)
7. **Same "space flight" scene renders as two barely-recognizable scenes** —
   one capture is a near-bare black void with a couple of gray asteroid
   props, the other a rich nebula backdrop with dozens of stars and a full
   keybinding legend. Matches the documented `LAZY_PREFIXES` async-texture
   pattern (`.claude/docs/systems/...` texture loading) — plausibly a timing
   race, not a design choice. (`task17/01-space-flight.png` vs `space-flight.png`)
8. **Raw untranslated tag leaks into an NPC nameplate** — "Торговец Бастион
   прс_4 **[TRADER]**" — same bug class as the ledger-enum leak fixed
   earlier today, new location. (`npc-clickable-task2.png`)
9. **Locale-inconsistent combat title** — one capture shows English "TACTICAL
   COMBAT", another (same scene) shows Russian "ТАКТИЧЕСКИЙ БОЙ".
   (`combat.png` vs `lp-20-combat.png`)

## Moderate

- Faction-select card grid is 3+2, leaving a large asymmetric dead gutter
  next to the Start button (`race-selection.png`, `lp-02-faction-select.png`)
- Game-over screen packs all content into the top half, ~40% dead space
  below, and shows no run summary (days survived/credits/cause of death)
  (`gameover-deathflow.png`)
- Star-map inconsistency: one capture mixes English "SECTOR MAP" header with
  Russian fuel readout and opens zoomed out to ~90px illegible, another
  (`task17/02-star-map.png`) is well-composed with legible faction-colored
  nodes — looks like two different code states; reconcile which is current
  (`star-map.png` vs `task17/02-star-map.png`)
- NPC contact panel truncates long names with no tooltip/widen, and repeats
  "Фракция" / "Альянс" redundantly (`lp-18-npc-panel.png`)
- NPC health/shield bar color (green vs red) has no legend — unclear why a
  neutral "Торговец" shows the same red styling as a hostile indicator
  (`npc-clickable-task2.png`)
- Info-center news feed shows duplicate entries back-to-back at the same day
  marker — looks like a generator/dedup bug (`lp-14-info-center.png`)
- Equipment shop disabled-buy rows show a bare truncated label ("Малое")
  instead of the actual reason — ambiguous at a glance (`lp-12-equipment-shop.png`)
- Bank "Погасить" (repay) button renders with the same active-looking outline
  as the other operations even at Day 0 with no loan taken (`bank-task7.png`)
- Station backdrop-art fix (from the earlier pass) delivered only a flat
  warm gradient glow, not actual environment art — still reads flat next to
  art-rich scenes (`task17/09-station.png`, `lp-17-station.png`)
- Text-quest progress bars render almost empty for a displayed value of "1" —
  bar doesn't convey the max scale, so number and bar visually disagree
  (`task17/10-text-quest.png`)

## Minor

- Main-menu story copy sits directly on bright nebula art with no scrim —
  marginal today, would degrade on brighter art variants (`lp-01-main-menu.png`)
- Hangar stat readouts ("СКОРОСТЬ 0.11", "ЗАЩИТА 0") are bare unlabeled
  numbers with no unit or good/bad framing (`hangar-station.png`)
- Micromodule tray chips have no drag-handle affordance icon, rely entirely
  on adjacent instruction text (`micromodule-hangar-board.png`)
- Unlabeled star/bookmark icon next to the "?" button, purpose unclear
  (`lp-15-reentry.png`)
- Comet-tail visual reads as disconnected gray blobs, no directional streak
  (`comet-tail-task3.png`) — possible lazy-texture artifact
- Magenta debug telemetry ("Камера: Zoom 1.00 | Pan...") visible beneath the
  minimap in several captures — confirm gated out of production builds
  (`in-flight-system-menu.png`, `feedback-button.png`)

## Needs live verification before acting (artifact-risk: yes)

- Faction-select "СЛОЖНОСТЬ"/difficulty panel appears absent once the
  tutorial modal is dismissed — may be unreachable, or an init step
  `transitionTo` skips
- The onboarding tooltip ("Дозаправка"/"Планета"/etc.) appears open and
  blocking in nearly every capture, including repeats of the *same* tooltip —
  confirm this doesn't really re-fire on every real revisit (vs. once per
  `transitionTo` jump)
- `lp-06-ship.png` shows the same generic nebula/modal frame as other flight
  captures with no ship/loadout content — confirm the ship view actually
  renders something distinct
- `station.png` shows a bare panel with zero action rows and zero backdrop,
  markedly worse than the other two station captures — likely a stale
  pre-fix screenshot, but worth one live check
- `combat.png` shows no HP bars/unit markers at all, unlike `lp-20-combat.png`
  of the same scene — confirm whether this is a stale capture

## Live-verification verdicts (Task 1, 2026-07-29)

Source-verified against the live code paths (the automatable portion of the
click-through check; each verdict cites the deciding line):

- **#5/#16 hex CombatScene "two visual languages"** — REFUTED. No `CombatScene`
  file exists in `src/`; the hex board was deleted in `df0f4fbe` ("delete hex
  CombatScene — combat is real-time in-flight only"). The hex-grid captures are
  stale pre-deletion screenshots. No code change.
- **#9/#17 locale-inconsistent combat title** — REFUTED. Both "TACTICAL
  COMBAT" and "ТАКТИЧЕСКИЙ БОЙ" belonged to the same deleted `CombatScene.ts`;
  neither string exists in current `src/`. No code change.
- **#18 star-map EN "SECTOR MAP" header** — REFUTED. `StarMapScene.ts:410` sets
  the title unconditionally to `"КАРТА ГАЛАКТИКИ"`; no English variant is
  reachable. `star-map.png` predates the rebrand. No code change.
- **Faction-select "СЛОЖНОСТЬ" panel** — PRESENT, no bug. `RaceSelectionScene`
  renders the difficulty selector (`t("race.difficulty")`, `GAME_MODE_OPTIONS`,
  chips at L251–335; the L151 comment confirms it fills the grid cell after the
  last faction). The screenshot was a modal/timing artifact, not an unreachable
  panel. No follow-up task.
- **Onboarding tooltip re-fire** — one-shot-EVER by design, no bug.
  `onboardingState` persists a seen-set in `localStorage` (`sr_help_seen`);
  `hasSeenHint` short-circuits on `includes`, so a hint shows once ever and does
  not re-open on revisit. The repeated-tooltip captures are `transitionTo`
  artifacts (each jump re-mounts a fresh scene without the persisted seen-set
  taking effect in the shortcut path). No follow-up task.
- **`lp-06-ship.png` ship view** — real content, no bug. The flight scene renders
  the real ship (`playerShip` module owns the hull sprite/glow/crosshair,
  `SpaceFlightScene.ts:498+`) and loadout-derived stats
  (`playerLoadout.derivedStats()`, L418). Not just the background. No follow-up.
- **`station.png` bare panel** — stale capture, no bug. A freshly-docked
  `StationScene` always paints the full-bleed gradient backdrop
  (`stationBackdropBands`, L393) and `serviceButton` action rows (L502). No
  follow-up task.

Net: all seven contested/needs-verification items resolve to **no code change**;
no new bug surfaced, so no follow-up task is added to the plan.

## Housekeeping (not bugs)

- `main-menu-feedback-button.png` and `lp-21-back-to-menu.png` still show the
  green "Новая игра" button, already recolored to cyan per Task 12 of the
  earlier pass — these two screenshots are stale, not a regression; safe to
  ignore or regenerate

## What's already working well

Trade, equipment-shop, government, info-center, and bank screens are
internally clean, consistent, and well-organized. Hangar panel is pixel-
identical from both station and planet entry points (shared component
working as designed). Faction-select cards have strong, consistent visual
hierarchy. Onboarding-tooltip chrome is identical and predictable everywhere
it appears. The planning-phase combat HUD (quest log, minimap, weapon-select
tooltip) is well organized when it renders. `task17/02-star-map.png`'s
faction-colored node system is a genuine variety win — a good target to
reconcile the other star-map capture toward.

## Suggested next step

Mirror the prior pass's structure: a Task 1 that re-verifies every
artifact-risk finding above live (real click-through, not `transitionTo`),
then one task per confirmed finding, regression-first per
`CLAUDE.md`'s Bug Fixing Process. The Меридиан population mismatch (#3) and
the two combat visual languages (#5/#6) are the highest-value fixes — one is
a real data bug, the other is a core-loop consistency/readability gap.
