import type { Container } from "pixi.js";
import { UiButton } from "./UiButton";
import { HelpPanel } from "./HelpPanel";
import type { Renderer } from "../Renderer";
import {
  helpFor,
  type HelpEntry,
  type HelpKey,
} from "@/systems/onboarding/helpContent";
import {
  hasSeen as defaultHasSeen,
  markSeen as defaultMarkSeen,
} from "@/systems/onboarding/onboardingState";

/**
 * One-call contextual-help wiring for a scene
 * (`docs/plans/20260623-onboarding-and-contextual-help.md`).
 *
 * A scene opts in with a single line in `initialize()`:
 * `this.helpTeardown = mountSceneHelp({ renderer, container }, "PLANET")`.
 * On mount it (1) auto-shows the help panel **once** the first time the key is
 * seen — then records it so it never nags again — and (2) always mounts a small
 * top-right «?» button that reopens the same help on demand. The returned
 * teardown removes both and must be called from the scene's `destroy()`.
 *
 * Persistence is injectable (`hasSeen`/`markSeen`) so tests drive a fake set;
 * by default it reads the browser-level `sr_help_seen` store.
 */
export interface SceneHelpDeps {
  /** Renderer — used for screen dimensions (panel centring, «?» placement). */
  readonly renderer: Renderer;
  /** The scene container the «?» button + panel mount into. */
  readonly container: Container;
  /** Has the player already seen this key's hint? (default: onboardingState) */
  readonly hasSeen?: (key: HelpKey) => boolean;
  /** Record this key's hint as seen (default: onboardingState). */
  readonly markSeen?: (key: HelpKey) => void;
}

/** Optional extras for {@link mountSceneHelp}. */
export interface SceneHelpOptions {
  /**
   * A one-shot intro shown (once) **instead of** `key`'s own first-time hint on
   * the very first mount, before `key`'s hint ever auto-shows. Used by the flight
   * scene to greet a brand-new player with the `welcome`/goal panel on the very
   * first entry, then fall through to the per-screen `SPACE_FLIGHT` controls hint
   * on the next visit. The «?» button always reopens `key`, not the intro.
   */
  readonly firstTimeKey?: HelpKey;
}

/**
 * Pure auto-show decision: a key's first-time hint pops automatically only when
 * it has not been seen yet. Factored out so it is trivially unit-testable with a
 * fake predicate (no renderer/DOM). The «?» button reopens regardless of this.
 */
export function shouldAutoShow(
  key: HelpKey,
  hasSeenKey: (key: HelpKey) => boolean,
): boolean {
  return !hasSeenKey(key);
}

/**
 * Pure: which key (if any) should auto-show on mount. An optional `firstTimeKey`
 * (the welcome/goal intro) wins on the very first mount; otherwise the scene's
 * own `key` shows the first time it is seen; once both are seen, nothing pops
 * (the «?» button still reopens on demand). Returns `null` when nothing auto-shows.
 */
export function pickAutoShowKey(
  key: HelpKey,
  firstTimeKey: HelpKey | undefined,
  hasSeenKey: (key: HelpKey) => boolean,
): HelpKey | null {
  if (firstTimeKey && shouldAutoShow(firstTimeKey, hasSeenKey)) {
    return firstTimeKey;
  }
  if (shouldAutoShow(key, hasSeenKey)) return key;
  return null;
}

/** Size of the square top-right «?» help button. */
export const HELP_BUTTON_SIZE = 34;
/** Margin from the screen's top-right corner. */
export const HELP_BUTTON_MARGIN = 12;

/**
 * The reserved top-right rectangle the «?» help button occupies, for a given
 * screen width. The single source of truth for the corner zone other top-right
 * HUD elements (e.g. the planet-screen credit balance) must avoid — so a fix to
 * the button placement keeps every consumer's no-overlap layout in lockstep.
 */
export function helpButtonRect(screenWidth: number): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: screenWidth - HELP_BUTTON_SIZE - HELP_BUTTON_MARGIN,
    y: HELP_BUTTON_MARGIN,
    w: HELP_BUTTON_SIZE,
    h: HELP_BUTTON_SIZE,
  };
}

/** A tracked open panel: itself + the container it was added to (for removal). */
interface TrackedHelpPanel {
  panel: HelpPanel;
  container: Container;
}

/**
 * Module-level registry of every currently-open help panel — normally at most
 * one (only one scene is active at once, and its teardown closes its own
 * panel), but a `Set` rather than a single slot so a rare stacked case (a
 * scene's own auto-hint plus a transient `showHelpOnce` panel both live at
 * once) can never cross-clobber each other's bookkeeping. Promoted to module
 * scope so it can be queried/dismissed WITHOUT a scene reference — this is
 * what lets the dev autopilot (F3, three-year-campaign Task 16b) detect and
 * close a help panel it can't see through the scene port: a live session
 * showed the autopilot acting through the port UNDER a full-screen help/
 * onboarding backdrop that blocks a real player's pointer but never
 * dismisses on its own.
 */
const openHelpPanels = new Set<TrackedHelpPanel>();

/** Whether any onboarding/contextual-help panel is currently open (F3). */
export function isHelpPanelOpen(): boolean {
  return openHelpPanels.size > 0;
}

/**
 * Dismiss ONE currently-open help panel (arbitrary if more than one is
 * stacked) — identical effect to the player clicking «Понятно»/«✕» (F3). A
 * safe no-op when nothing is open. The autopilot's per-tick loop calls this
 * repeatedly, so a rare multi-panel stack clears within a few ticks.
 */
export function dismissHelpPanel(): void {
  const tracked = openHelpPanels.values().next().value;
  if (!tracked) return;
  removeTrackedPanel(tracked);
}

function removeTrackedPanel(tracked: TrackedHelpPanel): void {
  openHelpPanels.delete(tracked);
  tracked.container.removeChild(tracked.panel.container);
  tracked.panel.destroy();
}

/**
 * Mount contextual help for `key` into the scene. Returns a teardown to call
 * from `destroy()`. Pass `options.firstTimeKey` to greet a brand-new player with
 * a one-shot intro (e.g. `welcome`) before `key`'s own first-time hint.
 */
export function mountSceneHelp(
  deps: SceneHelpDeps,
  key: HelpKey,
  options?: SceneHelpOptions,
): () => void {
  // Defensive: a minimal/headless renderer double (some unit-test fixtures) may
  // carry no `stage` container — the contextual-help overlay is non-essential, so
  // skip it rather than throw. The real Renderer always provides `stage`.
  if (!deps.container) return () => {};

  const hasSeen = deps.hasSeen ?? defaultHasSeen;
  const markSeen = deps.markSeen ?? defaultMarkSeen;

  // The currently-open panel FOR THIS MOUNT, if any (one at a time — unchanged
  // from before the shared registry existed).
  let tracked: TrackedHelpPanel | null = null;

  const closePanel = (): void => {
    if (!tracked) return;
    removeTrackedPanel(tracked);
    tracked = null;
  };

  const openPanel = (entry: HelpEntry): void => {
    if (tracked) return; // already open — ignore re-clicks
    const panel = new HelpPanel(deps.renderer, entry, closePanel);
    deps.container.addChild(panel.container);
    tracked = { panel, container: deps.container };
    openHelpPanels.add(tracked);
  };

  // The always-available top-right «?» reopen button — always opens `key`'s hint
  // (the scene's own help), never the one-shot intro.
  const helpBtn = new UiButton(
    "?",
    "",
    "primary",
    (e) => {
      e.stopPropagation();
      openPanel(helpFor(key));
    },
    HELP_BUTTON_SIZE,
    HELP_BUTTON_SIZE,
  );
  const reserved = helpButtonRect(deps.renderer.app.screen.width);
  helpBtn.x = reserved.x;
  helpBtn.y = reserved.y;
  deps.container.addChild(helpBtn.container);

  // First-time auto-hint: show the intro (if any + unseen) else the scene's own
  // hint, once, then mark that key seen so it won't pop again.
  const autoKey = pickAutoShowKey(key, options?.firstTimeKey, hasSeen);
  if (autoKey) {
    markSeen(autoKey);
    openPanel(helpFor(autoKey));
  }

  return () => {
    closePanel();
    deps.container.removeChild(helpBtn.container);
    helpBtn.container.destroy({ children: true });
  };
}

/**
 * Show a single dismissible help panel **once ever** for `key` (no «?» button) —
 * the one-shot contextual hint surfaced by a transient event rather than a screen
 * (e.g. the `combat` hint on the player's first in-flight engagement). If `key`
 * was already seen it is a no-op; otherwise it marks it seen and mounts the panel
 * into `deps.container`. Returns a teardown that closes the panel if still open.
 */
export function showHelpOnce(deps: SceneHelpDeps, key: HelpKey): () => void {
  if (!deps.container) return () => {}; // headless renderer double — skip (see above)
  const hasSeen = deps.hasSeen ?? defaultHasSeen;
  const markSeen = deps.markSeen ?? defaultMarkSeen;
  if (hasSeen(key)) return () => {};
  markSeen(key);

  let tracked: TrackedHelpPanel | null = null;
  const close = (): void => {
    if (!tracked) return;
    removeTrackedPanel(tracked);
    tracked = null;
  };
  const panel = new HelpPanel(deps.renderer, helpFor(key), close);
  deps.container.addChild(panel.container);
  tracked = { panel, container: deps.container };
  openHelpPanels.add(tracked);
  return close;
}
