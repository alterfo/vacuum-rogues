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

  constructor(private readonly deps: ContactPanelDeps) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  get openNpcId(): string | null {
    return this._openNpcId;
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
    // Defer teardown out of the current pointer-event dispatch so PixiJS's
    // event boundary is never mid-dispatch on a destroyed container.
    if (panel) queueMicrotask(() => panel.destroy());
  }
}
