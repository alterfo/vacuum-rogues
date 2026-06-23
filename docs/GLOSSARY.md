# Glossary

Project-specific vocabulary — the lore names, in-game Russian terms, system
jargon, tooling, and process coinages a newcomer wouldn't recognize. Prose is in
English; the in-game terms are quoted in their original Russian.

## World & lore
- **Вакуумные Пройдохи** (*Vacuum Rogues*) — the game's name. *Пройдоха* = a sly
  rogue/chancer; *вакуумный пройдоха* is the player: a free-flying space rascal.
- **Galactic Horizon: Neural Onslaught** — the prior working title; survives as the
  galaxy seed string `NEURAL_ONSLAUGHT`.
- **Space Rangers** — the original game this is a copyright-safe homage to; treated
  as the canon / "source of truth" for design.
- **Предтечи** (*Forerunners / Precursors*) — the in-game name of the **OVERMIND**
  faction. Their **Сверхразум** (Overmind / hive-mind) is the galactic threat that
  converts systems into a *безмолвный механический рой* (silent machine swarm).
- **Factions:** **OUTLANDERS** (Аутлендеры), **BASTIONS** (Бастионы), **SYNDICATE**
  (Синдикат), **PARADOXES** (Парадоксы), **PROGRESSORS** (Прогрессоры),
  **OVERMIND** (Предтечи), plus **PIRATE**, **WILDERNESS** (Глухомань) and
  **Независимые** (Independents). Two enums exist: `FactionType` for the playable
  alliances and `Faction` (which adds OVERMIND).
- **RaceType → FactionType** — the rebrand renamed "races" to "factions" for
  copyright safety.

## In-game Russian terms
- **Ход** — a turn/move; press «Ход» to advance time and fly a plotted route.
- **Атаковать / Сдаться / Бежать** — Attack / Surrender / Flee.
- **Кошелёк или жизнь** — "your wallet or your life," the pirate **shakedown**
  (tribute demand).
- **Местный подряд** — "Local contract," the buy-here / deliver-here delivery quest.
- **Quest types:** Доставка (DELIVERY), Охота (BOUNTY), Дипломатия (DIPLOMACY),
  Разведка (recon), Эскорт, Цепочка курьеров (courier chain).
- **Resources:** Топливо (FUEL), Металлы (METALS), Кристаллы (CRYSTALS), Органика
  (ORGANICS), Медикаменты (MEDICINE), Роскошь / предметы роскоши (LUXURY).
- **UI:** Оставить issue / Сообщить отзыв (feedback), Новая игра / Продолжить /
  Справка (New game / Continue / Help).

## Money system — «АБС»
- **АБС** — the in-game **Automated Banking System**, a core-banking prototype.
- **Леджер (ledger)** — the canonical double-entry general ledger; `player.credits`
  is only a **read projection** of the GL current-account balance (`cur:<id>`),
  never mutated directly.
- **Универсальная шина** — the typed command/event "universal bus" all money moves
  through (`adjustPlayerCredits` / `payTribute` / `transfer`).
- **EOD** — the end-of-day batch: interest accrual, statements, and the loan-default
  state machine.

## Ship & equipment
- **ShipLoadout / GearCatalog** — the single source of truth for the hull and every
  derived stat (cargo, slots, HP, weapon damage, speed).
- **Корпус (hull)**, **hull_corvette** (the starter corvette), **mass budget**
  (МАССА / СВОБОДНО) — a second capacity gate beyond slot count.
- **Micromodule (микромодуль)** — a craftable slot upgrade. Gear fits one of four
  **slot banks**: weapon / equipment / engine / radar.

## Combat & NPC
- **active-pause** — the Space-Rangers/FTL-style freeze on the first incoming hit
  (the pure `combatPause` state machine); «Огонь!» fires one shot and resumes.
- **shakedown / tribute** (дань), **garrison aggro**, **escalateHostility**,
  **crossfire**, **fireNpcShot**, **pruneDisengaged**, **WEAPON_RANGE** — in-flight
  real-time combat internals (the legacy hex `CombatScene` was removed).
- **NpcShipSprite**, **garrison** ships, **overmindCombatTargets** — NPC entities and
  the Overmind's indiscriminate-aggression targeting.

## Rendering & assets
- **PixiJS 8** (rendering) · **ONNX / onnxruntime-web** (local AI inference, run only
  in Web Workers).
- **Equirectangular** — the 360° projection planets and stars are mapped with;
  asset categories **panoramas / planet_maps / star_maps / surfaces / nebula**.
- **pickVariant / pickVariantKey** — stable per-entity art selection by id;
  **LAZY_PREFIXES** — heavy art categories excluded from eager boot preload.
- **twinkle stars** (bright "hero" stars), **dust streaks** (the removed
  velocity-scaled speed-streaks), **comet coma/tail**, **softGlowTexture** (a baked
  glow gradient — no per-frame `BlurFilter` in the flight scene).
- **FlightModule** — the `initialize / update / destroy` flight sub-module interface;
  **SceneType** — the scene enum.

## Tooling & process
- **ralphex** — the autonomous plan-execution runner (TDD loop + multi-agent code
  review); plans live in `docs/plans/`.
- **gitnexus** — code-intelligence MCP: impact / blast-radius analysis, semantic
  query over the dependency graph.
- **vacuum** — symbol-body lookup MCP (`find_symbol` / `find_tests_for`).
- **ComfyUI** — the art-generation pipeline (`tools/comfyui/generate_assets.py` on
  the RTX 4090 host); output WebP, rsync into `src/assets/`.
- **lefthook** — the git-hook gate (format / lint / test / build on commit & push).
- **blast radius / Pareto filter** — assess what a change breaks; fix only the
  high-risk 20% of touch-points.
- **lockstep** — a domain/type change must update the Zod `schemas.ts` in the same
  step, or save games break.
- **regression-first** — every bug starts as a red test before the fix.
- **letsplay / monkey / smoke / playtest-regression** — the E2E test families.
