import type { Container } from "pixi.js";
import { NpcContactPanel, type NpcContactCallbacks } from "../NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import type { CommsContext } from "@/systems/comms/commsOptions";

export interface ContactPanelDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
}

/**
 * Owns the NPC contact-panel lifecycle: a single open panel at a time, with
 * deferred teardown so PixiJS event dispatch on the container is never
 * interrupted mid-frame.
 */
export class ContactPanelManager {
  private panel: NpcContactPanel | null = null;
  private _openNpcId: string | null = null;
  private _context: CommsContext | undefined = undefined;

  constructor(private readonly deps: ContactPanelDeps) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  get openNpcId(): string | null {
    return this._openNpcId;
  }

  /**
   * The comms context the open panel was opened in (`"pirate-shakedown"`,
   * `"neutral"`, …), or `undefined` when none is open or the panel was opened
   * without one. Additive getter exposing the `context` param already threaded
   * through {@link open} — lets a non-clicking driver (the dev-only live
   * autopilot) tell a shakedown hail apart from a regular contact panel and
   * drive the real pay/attack/flee handler instead of blind-closing it.
   */
  get context(): CommsContext | undefined {
    return this._context;
  }

  hasOpenModal(): boolean {
    return this.panel !== null;
  }

  open(
    npc: NpcShip,
    callbacks: NpcContactCallbacks,
    inRange: boolean,
    scanPower: number,
    context?: CommsContext,
  ): void {
    this.close();
    this._openNpcId = npc.id;
    this._context = context;
    const { width, height } = this.deps.getScreenSize();
    this.panel = new NpcContactPanel(
      npc,
      width,
      height,
      callbacks,
      inRange,
      scanPower,
      context,
    );
    this.deps.uiLayer.addChild(this.panel.container);
  }

  close(): void {
    const panel = this.panel;
    this.panel = null;
    this._openNpcId = null;
    this._context = undefined;
    // Defer teardown out of the current pointer-event dispatch so PixiJS's
    // event boundary is never mid-dispatch on a destroyed container.
    if (panel) queueMicrotask(() => panel.destroy());
  }
}
