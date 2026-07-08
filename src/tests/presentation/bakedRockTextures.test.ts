/**
 * Natural comet/asteroid rework (2026-06-20) — Task 1.
 *
 * The flat `Graphics` comet tail + polygon rocks are replaced by particle/
 * sprite rendering fed from two baked, cached procedural textures:
 *   - `dustParticleTexture()` — a soft alpha dot for the comet dust tail.
 *   - `rockTexture(seed)` — a small set of baked, shaded irregular grey rocks.
 *
 * Both must bake ONCE and be reused (no per-frame regeneration), produce
 * distinct rocks for distinct seeds, and be null-safe when no 2D canvas context
 * is available (jsdom) — exactly like the existing `softGlowTexture`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Each `Texture.from(canvas)` returns a fresh object, so reference identity is a
// faithful proxy for "same baked texture" vs "a different one".
const hoisted = vi.hoisted(() => ({ counter: 0 }));

vi.mock("pixi.js", () => ({
  Texture: {
    from: vi.fn(() => ({ id: `tex-${++hoisted.counter}` })),
  },
}));

/** A throwaway Canvas2D context covering only the calls the helpers make. */
function mockCtx(): Record<string, unknown> {
  const grad = { addColorStop: vi.fn() };
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    createRadialGradient: vi.fn(() => grad),
    createLinearGradient: vi.fn(() => grad),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

const realGetContext = HTMLCanvasElement.prototype.getContext;

describe("baked dust + rock textures (canvas available)", () => {
  beforeEach(() => {
    // Fresh module instance per test → fresh module-level caches, so caching is
    // observed within a test rather than leaking across them.
    vi.resetModules();
    hoisted.counter = 0;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx()) as never;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it("dustParticleTexture bakes a non-null texture and caches it (baked once)", async () => {
    const { dustParticleTexture } =
      await import("@/presentation/gradientTexture");
    const a = dustParticleTexture();
    const b = dustParticleTexture();
    expect(a).not.toBeNull();
    expect(b).toBe(a); // reused, not re-baked
  });

  it("rockTexture bakes a non-null texture and reuses it for the same seed", async () => {
    const { rockTexture } = await import("@/presentation/gradientTexture");
    const a = rockTexture(0);
    const b = rockTexture(0);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it("distinct rock seeds produce distinct textures", async () => {
    const { rockTexture } = await import("@/presentation/gradientTexture");
    const r0 = rockTexture(0);
    const r1 = rockTexture(1);
    const r2 = rockTexture(2);
    expect(r0).not.toBeNull();
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1).not.toBe(r0);
    expect(r2).not.toBe(r0);
    expect(r2).not.toBe(r1);
  });

  it("seeds wrap onto a bounded variant set (same variant → same texture)", async () => {
    const { rockTexture, ROCK_VARIANT_COUNT } =
      await import("@/presentation/gradientTexture");
    // seed and seed+ROCK_VARIANT_COUNT map to the same baked variant.
    expect(rockTexture(0)).toBe(rockTexture(ROCK_VARIANT_COUNT));
  });

  it("starPointTexture bakes a non-null texture for hero and non-hero and caches each", async () => {
    const { starPointTexture } = await import("@/presentation/gradientTexture");
    const heroA = starPointTexture(true);
    const heroB = starPointTexture(true);
    const normalA = starPointTexture(false);
    const normalB = starPointTexture(false);
    expect(heroA).not.toBeNull();
    expect(normalA).not.toBeNull();
    expect(heroB).toBe(heroA); // reused, not re-baked
    expect(normalB).toBe(normalA); // reused, not re-baked
    expect(heroA).not.toBe(normalA); // distinct hero vs non-hero bake
  });

  it("nebulaCloudTexture bakes a non-null texture and reuses it for the same seed", async () => {
    const { nebulaCloudTexture } =
      await import("@/presentation/gradientTexture");
    const a = nebulaCloudTexture(0);
    const b = nebulaCloudTexture(0);
    expect(a).not.toBeNull();
    expect(b).toBe(a); // reused, not re-baked
  });

  it("distinct nebula seeds produce distinct cached textures", async () => {
    const { nebulaCloudTexture } =
      await import("@/presentation/gradientTexture");
    const n0 = nebulaCloudTexture(0);
    const n1 = nebulaCloudTexture(1);
    expect(n0).not.toBeNull();
    expect(n1).not.toBeNull();
    expect(n1).not.toBe(n0);
  });

  it("nebula seeds wrap onto a bounded variant set (same variant → same texture)", async () => {
    const { nebulaCloudTexture, NEBULA_VARIANT_COUNT } =
      await import("@/presentation/gradientTexture");
    expect(nebulaCloudTexture(0)).toBe(
      nebulaCloudTexture(NEBULA_VARIANT_COUNT),
    );
  });
});

describe("baked textures are null-safe without a 2D context", () => {
  beforeEach(() => {
    vi.resetModules();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  it("dustParticleTexture returns null (jsdom fallback, no throw)", async () => {
    const { dustParticleTexture } =
      await import("@/presentation/gradientTexture");
    expect(dustParticleTexture()).toBeNull();
  });

  it("rockTexture returns null (jsdom fallback, no throw)", async () => {
    const { rockTexture } = await import("@/presentation/gradientTexture");
    expect(rockTexture(0)).toBeNull();
  });

  it("starPointTexture returns null for both hero and non-hero (jsdom fallback, no throw)", async () => {
    const { starPointTexture } = await import("@/presentation/gradientTexture");
    expect(starPointTexture(true)).toBeNull();
    expect(starPointTexture(false)).toBeNull();
  });

  it("nebulaCloudTexture returns null (jsdom fallback, no throw)", async () => {
    const { nebulaCloudTexture } =
      await import("@/presentation/gradientTexture");
    expect(nebulaCloudTexture(0)).toBeNull();
  });
});
