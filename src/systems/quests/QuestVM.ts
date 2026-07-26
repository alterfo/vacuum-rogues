import { SeededRNG } from "@/utils/seededRNG";
import { GameSystemException } from "@/exceptions/GameSystemException";
import type {
  QuestScript,
  QuestLocation,
  QuestTransition,
} from "./QuestScript";

/**
 * Stable, RNG-free string hash (Math.imul FNV-style, same family as
 * `SeededRNG.hashSeed`). Used to pick a text-pool variant deterministically
 * from `(seed, locationId)` WITHOUT touching the VM's `SeededRNG` stream — so
 * adding/removing text variants never shifts an already-shipped quest's
 * `random(min,max)` rolls (which depend on call order into `this.rng`).
 */
export function questTextHash(key: string): number {
  let h = 2166136261 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Resolve a location's `text` (scalar or variance pool) to a single string,
 * given the run's `seed`. Pure — exported for direct testing. An empty pool
 * resolves to "".
 */
export function resolveLocationText(
  text: string | string[],
  seed: string,
  locationId: string,
): string {
  if (typeof text === "string") return text;
  if (text.length === 0) return "";
  return text[questTextHash(`${seed}:${locationId}`) % text.length];
}

export class QuestVM {
  private params: Map<string, number>;
  private currentLocationId: string;
  private rng: SeededRNG;
  private readonly seed: string;

  constructor(
    private script: QuestScript,
    seed: string | number,
  ) {
    this.seed = String(seed);
    this.rng = new SeededRNG(this.seed);
    this.params = new Map();

    for (const param of script.params) {
      const value =
        param.initial === "random"
          ? this.rng.nextInt(param.min, param.max)
          : param.initial;
      this.params.set(param.id, value);
    }

    this.currentLocationId = script.startLocation;
  }

  currentLocation(): QuestLocation {
    const loc = this.script.locations.find(
      (l) => l.id === this.currentLocationId,
    );
    if (!loc) throw new Error(`Location not found: ${this.currentLocationId}`);
    return loc;
  }

  /**
   * The current location's narration text with a variance pool resolved to one
   * deterministic variant. Renderers should call this (then `interpolate`)
   * rather than reading `loc.text` directly, which may be a `string[]`.
   */
  currentLocationText(): string {
    const loc = this.currentLocation();
    return resolveLocationText(loc.text, this.seed, loc.id);
  }

  availableTransitions(): QuestTransition[] {
    return this.currentLocation().transitions.filter(
      (t) => t.condition === undefined || this.evaluate(t.condition),
    );
  }

  execute(transitionId: string): void {
    const transition = this.availableTransitions().find(
      (t) => t.id === transitionId,
    );
    if (!transition)
      throw new Error(`Transition not available: ${transitionId}`);

    for (const effect of transition.effects) {
      this.applyEffect(effect);
    }

    this.currentLocationId = transition.toLocation;
    this.checkCriticalThresholds();
  }

  private checkCriticalThresholds(): void {
    // Terminal locations must not be interrupted by critical thresholds
    const current = this.script.locations.find(
      (l) => l.id === this.currentLocationId,
    );
    if (current?.isSuccess || current?.isFailure) return;

    for (const param of this.script.params) {
      if (!param.critTarget) continue;
      const value = this.params.get(param.id) ?? 0;
      if (param.critMin !== undefined && value < param.critMin) {
        this.currentLocationId = param.critTarget;
        return;
      }
      if (param.critMax !== undefined && value > param.critMax) {
        this.currentLocationId = param.critTarget;
        return;
      }
    }
  }

  evaluate(expr: string): boolean {
    const m = expr.match(/^(\w+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)$/);
    if (!m) throw new Error(`Bad condition: ${expr}`);
    const [, name, op, val] = m;
    const v = this.params.get(name) ?? 0;
    const n = Number(val);
    switch (op) {
      case ">=":
        return v >= n;
      case "<=":
        return v <= n;
      case "==":
        return v === n;
      case "!=":
        return v !== n;
      case ">":
        return v > n;
      case "<":
        return v < n;
      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }

  applyEffect(expr: string): void {
    // random(min,max) assignment: name = random(min,max)
    const randAssign = expr.match(/^(\w+)\s*=\s*random\((\d+),(\d+)\)$/);
    if (randAssign) {
      const [, name, min, max] = randAssign;
      this.params.set(name, this.rng.nextInt(Number(min), Number(max)));
      return;
    }

    // compound assignment: name op= value  (e.g. money -= 100)
    const compound = expr.match(/^(\w+)\s*([+\-*/])=\s*(-?\d+)$/);
    if (compound) {
      const [, name, op, val] = compound;
      const current = this.params.get(name) ?? 0;
      this.params.set(name, this.applyOp(current, op, Number(val)));
      return;
    }

    // simple assignment: name = number
    const simple = expr.match(/^(\w+)\s*=\s*(-?\d+)$/);
    if (simple) {
      const [, name, val] = simple;
      this.params.set(name, Number(val));
      return;
    }

    // expression assignment: name = param op value  (e.g. money = money * 2)
    const exprAssign = expr.match(/^(\w+)\s*=\s*(\w+)\s*([+\-*/])\s*(-?\d+)$/);
    if (exprAssign) {
      const [, target, srcName, op, val] = exprAssign;
      const src = this.params.get(srcName) ?? 0;
      this.params.set(target, this.applyOp(src, op, Number(val)));
      return;
    }

    throw new Error(`Bad effect: ${expr}`);
  }

  private applyOp(current: number, op: string, n: number): number {
    if (op === "/" && n === 0) {
      throw new GameSystemException(
        "QUEST_VM_DIVIDE_BY_ZERO",
        `QuestVM: division by zero in effect`,
      );
    }
    switch (op) {
      case "+":
        return current + n;
      case "-":
        return current - n;
      case "*":
        return current * n;
      case "/":
        return Math.floor(current / n);
      default:
        return current;
    }
  }

  interpolate(text: string | string[]): string {
    // Tolerate a variance pool for callers that pass `loc.text` verbatim; the
    // pool is resolved against the current location (which owns that array).
    const src =
      typeof text === "string"
        ? text
        : resolveLocationText(text, this.seed, this.currentLocationId);
    return src.replace(/\{(\w+)\}/g, (_, name) => {
      const v = this.params.get(name);
      return v !== undefined ? String(v) : `{${name}}`;
    });
  }

  isFinished(): boolean {
    const loc = this.currentLocation();
    return !!(loc.isSuccess || loc.isFailure);
  }

  isSuccess(): boolean {
    return !!this.currentLocation().isSuccess;
  }

  getParam(id: string): number {
    return this.params.get(id) ?? 0;
  }

  setParam(id: string, value: number): void {
    this.params.set(id, value);
  }
}
