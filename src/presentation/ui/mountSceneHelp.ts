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

export interface SceneHelpDeps {
  readonly renderer: Renderer;
  readonly container: Container;
  readonly hasSeen?: (key: HelpKey) => boolean;
  readonly markSeen?: (key: HelpKey) => void;
}

export interface SceneHelpOptions {
  readonly firstTimeKey?: HelpKey;
}

export function shouldAutoShow(
  key: HelpKey,
  hasSeenKey: (key: HelpKey) => boolean,
): boolean {
  return !hasSeenKey(key);
}

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

export const HELP_BUTTON_SIZE = 34;
export const HELP_BUTTON_MARGIN = 12;

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

interface TrackedHelpPanel {
  panel: HelpPanel;
  container: Container;
}

const openHelpPanels = new Set<TrackedHelpPanel>();

export function isHelpPanelOpen(): boolean {
  return openHelpPanels.size > 0;
}

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

export function mountSceneHelp(
  deps: SceneHelpDeps,
  key: HelpKey,
  options?: SceneHelpOptions,
): () => void {
  if (!deps.container) return () => {};

  const hasSeen = deps.hasSeen ?? defaultHasSeen;
  const markSeen = deps.markSeen ?? defaultMarkSeen;

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
