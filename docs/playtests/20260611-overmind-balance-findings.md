# Overmind / Galaxy Balance — Findings & Design (2026-06-11)

## Bug (diagnosed, ground-truthed by simulation)
"Я не успел пролететь и пары дней — конец игры, overmind победил."

Loss = `GameEngine.simulateDay` → `galaxy.isOvermindMajority()` (`overmindSystems.length > systems.length/2`), checked every day, with **zero counterplay, no warning**. Overmind expansion adds 1 adjacent system every 5 days (`GameEngine.ts:441-459`); the only `addOvermindSystem` caller. Simulated loss day by galaxy size (fresh, no player input):

| Systems | Loss day | Note |
|---|---|---|
| 4 | **0** | 2/4 start → +1 at day 0 → 3/4 majority instantly |
| 6 | 5 | |
| 10 | 15 | |
| 30 | **never** | expansion caps at ~9 (adjacency runs out) < 16 majority |

A fresh game is 30 systems (`main.ts:121`) → overmind is **toothless**. The user lost → they were on a **small-galaxy save** (auto-loaded stale save from an old default of 10 systems; `GameEngine` auto-loads on boot, `:191-195`). So the mechanic is broken at both ends: never fires at 30, instant at ≤4. No player counterplay exists anywhere.

## Design (user vision, 2026-06-11)
1. **Self-balancing galaxy that persists "forever" on its own**, with a small bias toward pirate/overmind capture. Without the player, the galaxy reaches a stable equilibrium — overmind/pirate share oscillates around a low value and **never trends to majority**.
2. **Only the player disturbs the balance** — the galaxy is otherwise homeostatic.
3. **Progression arc:** the player needs time to develop — earn credits, buy the best hull + weapons — and then can **liberate overmind/pirate systems solo** in combat. Early game cannot; late game can.

## Mechanism (negative feedback = stability)
- Per tick (every K days), contested *border* systems may flip:
  - Overmind/pirates capture an adjacent faction system with prob `pCapture`.
  - Factions recapture an adjacent overmind/pirate system with prob `pRecapture`.
- **Stabilizer:** `pRecapture` rises (or `pCapture` falls) as the overmind/pirate share grows — the more they hold, the harder the galaxy pushes back. This pins a stable equilibrium at a low share with a slight overmind bias, instead of a runaway. Verify by simulation, not by hand-tuning alone.
- **Player lever:** winning combat in an overmind/pirate system liberates it (flips to faction) — the only external force on the equilibrium. Combat difficulty in those systems scales so only a well-geared player can solo them.

## Acceptance (the linchpin)
A simulation test over 2000+ days with NO player input must show overmind share staying inside a target band (e.g. 8–25%) and `isOvermindMajority()` never true — proving the galaxy "lives forever." Plus a test that player liberation reduces the overmind set and a few liberations visibly shift the balance.

## Tuned Constants (Task 3, 2026-06-11)

Tuned via 2000-day simulation over 3 independent seeds ("alpha", "beta", "gamma"). Final values in `src/config/balance.ts`:

| Constant | Value | Rationale |
|---|---|---|
| `OVERMIND_CAPTURE_PROB` | 0.25 | Faster growth from floor state; topology factor ~3 compensates to keep equilibrium below ceiling |
| `OVERMIND_RECAPTURE_BASE_PROB` | 0.12 | Slightly above pCapture/3 so topology-adjusted equilibrium lands at ~17% |
| `OVERMIND_FEEDBACK_STRENGTH` | 4.0 | Hard ceiling: pCapture = 0 when share ≥ 25% — guarantees rolling average stays below majority |
| `OVERMIND_BALANCE_INTERVAL` | 5 | Tick cadence (game days) |
| `OVERMIND_FLOOR_MIN` | 3 | Natural balance tick always maintains at least 3 hostile systems; only player combat (Task 4) can reduce below this |

**Observed equilibrium band (3 seeds, 2000-day runs):**
- Rolling 200-day average after warmup (day 300+): **10–24%** (3–7 systems out of 30)
- Majority (>50%) never reached for any seed across 400 ticks
- No upward trend: avg share in days 1200–2000 ≤ avg share in days 700–1200 + 3%
- Hard ceiling: pCapture = 0 at 25% share (8/30 systems) — balance tick cannot push galaxy past 7 systems

**Analytical equilibrium (topology-adjusted, d=3):**
`3 × pCapture × (1 − fs×s) = pRecaptureBase × (1 + fs×s)`
→ `s ≈ 18%` (~5–6 systems) for a typical 30-node graph with average degree 3.

**Floor mechanism:** when the balance tick would drop below `OVERMIND_FLOOR_MIN` (3 systems), the `GameEngine` wrapper reseeds random non-player faction systems up to the floor minimum. This prevents the cosmological constant from collapsing to zero from natural forces alone.
