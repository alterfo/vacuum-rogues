/**
 * Letsplay engine — the neural feature gate for policy selection (dev-only).
 *
 * `isNeuralEnabled()` (default **false**) is the single switch that decides which
 * brain plays the game:
 *
 *  - **off (default)** ⇒ the rule-based {@link HeuristicPolicy}. No
 *    {@link NeuralPolicy} is constructed and **no MLP weights are touched** — the
 *    lean, ship-default path.
 *  - **on** ⇒ a {@link NeuralPolicy}. With trained `weights` it runs the pure-TS
 *    MLP; with none it stays inert and falls back to the heuristic (so the agent
 *    loop keeps running either way). This is the gate the (deferred) neural AI
 *    sits behind.
 *
 * The flag is consulted through {@link gameSettings.isNeuralEnabled}, so the
 * settings-panel toggle and this gate read the **same** `localStorage` source of
 * truth. `enabled` is injectable for tests / explicit control.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module. Importing
 * the production settings store from here is the allowed one-way direction
 * (`letsplayDevOnly.test.ts` only bans the reverse edge).
 */
import { isNeuralEnabled } from "@/systems/settings/gameSettings";
import type { PlayerPolicy } from "./PlayerPolicy";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { NeuralPolicy } from "./NeuralPolicy";

/** Options for {@link selectPlayerPolicy}. */
export interface PolicyGateOptions {
  /**
   * Override the flag (defaults to the live `isNeuralEnabled()`). Pass an
   * explicit boolean in tests / when the caller already knows the setting.
   */
  readonly enabled?: boolean;
  /**
   * Trained `*.weights.json` for the neural policy (used only when enabled).
   * Absent ⇒ the {@link NeuralPolicy} is inert and falls back to the heuristic.
   */
  readonly weights?: unknown;
}

/**
 * Select the player policy behind the neural feature gate. **Off** (default)
 * returns a fresh {@link HeuristicPolicy} — the {@link NeuralPolicy} is never
 * even constructed, so no weights are loaded. **On** returns a fresh
 * {@link NeuralPolicy} (which loads `weights` lazily via `load()` when present,
 * else stays inert and falls back to the heuristic). Pure construction; never
 * throws.
 */
export function selectPlayerPolicy(opts: PolicyGateOptions = {}): PlayerPolicy {
  const enabled = opts.enabled ?? isNeuralEnabled();
  if (!enabled) return new HeuristicPolicy();
  const policy = new NeuralPolicy({ weights: opts.weights });
  if (opts.weights !== undefined) {
    // Adopt the trained weights now so `decide` runs the net instead of the
    // inert heuristic fallback. `load()`'s body is synchronous (no `await`), so
    // the weights are adopted before this returns; a malformed-weights throw is
    // swallowed to keep the gate's never-throws contract (decide then falls back
    // to the heuristic). With no `weights` the policy stays inert as before.
    void policy.load().catch(() => {});
  }
  return policy;
}
