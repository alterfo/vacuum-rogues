import type { Container } from "pixi.js";
import { UiButton } from "./UiButton";
import { HelpPanel } from "./HelpPanel";
import type { Renderer } from "../Renderer";
import { helpFor, type HelpKey } from "@/systems/onboarding/helpContent";
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

/** Size of the square top-right «?» help button. */
const HELP_BUTTON_SIZE = 34;
/** Margin from the screen's top-right corner. */
const HELP_BUTTON_MARGIN = 12;

/**
 * Mount contextual help for `key` into the scene. Returns a teardown to call
 * from `destroy()`.
 */
export function mountSceneHelp(deps: SceneHelpDeps, key: HelpKey): () => void {
  const hasSeen = deps.hasSeen ?? defaultHasSeen;
  const markSeen = deps.markSeen ?? defaultMarkSeen;
  const entry = helpFor(key);

  // The currently-open panel, if any (one at a time).
  let panel: HelpPanel | null = null;

  const closePanel = (): void => {
    if (!panel) return;
    deps.container.removeChild(panel.container);
    panel.destroy();
    panel = null;
  };

  const openPanel = (): void => {
    if (panel) return; // already open — ignore re-clicks
    panel = new HelpPanel(deps.renderer, entry, closePanel);
    deps.container.addChild(panel.container);
  };

  // The always-available top-right «?» reopen button.
  const helpBtn = new UiButton(
    "?",
    "",
    "primary",
    (e) => {
      e.stopPropagation();
      openPanel();
    },
    HELP_BUTTON_SIZE,
    HELP_BUTTON_SIZE,
  );
  const sw = deps.renderer.app.screen.width;
  helpBtn.x = sw - HELP_BUTTON_SIZE - HELP_BUTTON_MARGIN;
  helpBtn.y = HELP_BUTTON_MARGIN;
  deps.container.addChild(helpBtn.container);

  // First-time auto-hint: show once, then mark seen so it won't pop again.
  if (shouldAutoShow(key, hasSeen)) {
    markSeen(key);
    openPanel();
  }

  return () => {
    closePanel();
    deps.container.removeChild(helpBtn.container);
    helpBtn.container.destroy({ children: true });
  };
}
