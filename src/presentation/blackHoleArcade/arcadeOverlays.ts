import { Container, Graphics } from "pixi.js";
import { scaledText } from "../ui/scaledText";

const PANEL = 0x0b0818;
const EDGE = 0x6a5cc0;
const TEXT = 0xe8e2ff;
const DIM = 0xa59cc8;
const ACCENT = 0xffd166;

export interface OverlayArea {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

function centered(
  container: Container,
  text: string,
  size: number,
  color: number,
  x: number,
  y: number,
  bold = false,
): number {
  const node = scaledText(text, size, color, {
    rawColor: true,
    align: "center",
    ...(bold ? { fontWeight: "bold" as const } : {}),
  });
  node.anchor.set(0.5, 0);
  node.x = x;
  node.y = y;
  node.eventMode = "none";
  container.addChild(node);
  return node.height || size * 1.3;
}

function dim(container: Container, area: OverlayArea, alpha: number): void {
  const g = new Graphics();
  g.rect(0, 0, area.width, area.height).fill({ color: 0x000000, alpha });
  g.eventMode = "static";
  container.addChild(g);
}

function panel(
  container: Container,
  x: number,
  y: number,
  w: number,
  h: number,
  edge = EDGE,
): void {
  const g = new Graphics();
  g.roundRect(x, y, w, h, 10).fill({ color: PANEL, alpha: 0.94 });
  g.roundRect(x, y, w, h, 10).stroke({ color: edge, width: 2, alpha: 0.9 });
  g.eventMode = "none";
  container.addChild(g);
}

export function button(
  container: Container,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  onClick: () => void,
): void {
  const holder = new Container();
  holder.x = x;
  holder.y = y;
  const bg = new Graphics();
  const draw = (hover: boolean): void => {
    bg.clear();
    bg.roundRect(0, 0, w, h, 8).fill({ color: hover ? 0x241c4a : 0x120d2a });
    bg.roundRect(0, 0, w, h, 8).stroke({ color, width: hover ? 3 : 2 });
  };
  draw(false);
  holder.addChild(bg);
  const text = scaledText(label, 16, color, {
    rawColor: true,
    fontWeight: "bold",
  });
  text.anchor.set(0.5);
  text.x = w / 2;
  text.y = h / 2;
  text.eventMode = "none";
  holder.addChild(text);
  holder.eventMode = "static";
  holder.cursor = "pointer";
  holder.on("pointerdown", (event) => {
    event.stopPropagation();
    onClick();
  });
  holder.on("pointerover", () => draw(true));
  holder.on("pointerout", () => draw(false));
  container.addChild(holder);
}

export function buildBanner(
  area: OverlayArea,
  title: string,
  subtitle: string | null,
  color: number,
): Container {
  const root = new Container();
  const y = area.cy - 120;
  centered(root, title, 38, color, area.cx, y, true);
  if (subtitle) centered(root, subtitle, 20, TEXT, area.cx, y + 52);
  root.eventMode = "none";
  return root;
}

export interface IntermissionText {
  title: string;
  cleared: string;
  reward: string;
  next: string;
  continueLabel: string;
  cashOutLabel: string;
}

export function buildIntermission(
  area: OverlayArea,
  text: IntermissionText,
  onContinue: () => void,
  onCashOut: () => void,
): Container {
  const root = new Container();
  dim(root, area, 0.55);
  const w = Math.min(520, area.width - 40);
  const h = 330;
  const x = area.cx - w / 2;
  const y = area.cy - h / 2;
  panel(root, x, y, w, h);
  centered(root, text.title, 30, ACCENT, area.cx, y + 24, true);
  centered(root, text.cleared, 18, TEXT, area.cx, y + 78);
  centered(root, text.reward, 22, ACCENT, area.cx, y + 112, true);
  centered(root, text.next, 15, DIM, area.cx, y + 152);
  button(
    root,
    text.continueLabel,
    x + 40,
    y + 200,
    w - 80,
    48,
    0x5eea7a,
    onContinue,
  );
  button(
    root,
    text.cashOutLabel,
    x + 40,
    y + 262,
    w - 80,
    48,
    ACCENT,
    onCashOut,
  );
  return root;
}

export interface PauseText {
  title: string;
  resumeLabel: string;
  leaveLabel: string;
}

export function buildPause(
  area: OverlayArea,
  text: PauseText,
  onResume: () => void,
  onLeave: () => void,
): Container {
  const root = new Container();
  dim(root, area, 0.6);
  const w = Math.min(500, area.width - 40);
  const h = 250;
  const x = area.cx - w / 2;
  const y = area.cy - h / 2;
  panel(root, x, y, w, h);
  centered(root, text.title, 30, TEXT, area.cx, y + 24, true);
  button(
    root,
    text.resumeLabel,
    x + 40,
    y + 90,
    w - 80,
    48,
    0x5eea7a,
    onResume,
  );
  button(root, text.leaveLabel, x + 40, y + 154, w - 80, 48, 0xf87171, onLeave);
  return root;
}

export interface EndText {
  title: string;
  stats: string;
  reward: string;
  exit: string;
}

export function buildEnd(
  area: OverlayArea,
  text: EndText,
  color: number,
  onExit: () => void,
): Container {
  const root = new Container();
  dim(root, area, 0.7);
  const w = Math.min(600, area.width - 40);
  const h = 280;
  const x = area.cx - w / 2;
  const y = area.cy - h / 2;
  panel(root, x, y, w, h, color);
  centered(root, text.title, 32, color, area.cx, y + 28, true);
  centered(root, text.stats, 17, TEXT, area.cx, y + 92);
  centered(root, text.reward, 28, ACCENT, area.cx, y + 130, true);
  button(root, text.exit, x + 40, y + 202, w - 80, 52, color, onExit);
  return root;
}
