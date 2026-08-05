import type { Container } from "pixi.js";
import { NpcContactPanel, type NpcContactCallbacks } from "../NpcContactPanel";
import type { NpcShip } from "@/domain/NpcShip";
import type { CommsContext } from "@/systems/comms/commsOptions";

export interface ContactPanelDeps {
  uiLayer: Container;
  getScreenSize(): { width: number; height: number };
}

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
    if (panel) queueMicrotask(() => panel.destroy());
  }
}
