/**
 * 360° panorama viewer (ART Task 8 / US-075).
 *
 * Renders an equirectangular panorama as a ground-level, drag-to-look
 * background. A GLSL {@link Filter} reprojects the equirectangular source into a
 * **rectilinear** (gnomonic) slice for the visible field of view, so straight
 * features stay straight instead of bowing the way a raw equirectangular crop
 * would. Horizontal look-around is the `uPanX` longitude uniform, advanced by
 * pointer/touch drag and wrapped into [0, 1) — a full 360° loop with no seam.
 *
 * The component is self-contained: it owns a full-screen {@link Sprite} carrying
 * the panorama texture (so the filter has valid bounds to run over), installs
 * its own drag handlers via PixiJS `globalpointermove`, and composites a subtle
 * vignette in-shader as the final darkening overlay at the view edges.
 *
 * Pure-presentation helper. Construction is guarded by
 * {@link createPanoramaViewer} so callers can fall back to a flat panorama
 * sprite on any PixiJS API mismatch (e.g. a WebGPU-only renderer — we only ship
 * a WebGL program).
 */
import {
  Container,
  Filter,
  GlProgram,
  Sprite,
  Texture,
  UniformGroup,
  type FederatedPointerEvent,
} from "pixi.js";

// Standard PixiJS v8 filter vertex shader (matches the built-in default): maps
// the filter quad and emits vTextureCoord in [0,1] over the sprite's bounds.
const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;     // filter input (unused — kept for the binding)
uniform sampler2D uMapTexture;  // equirectangular panorama

uniform float uPanX;     // longitude pan, [0,1) — wraps seamlessly
uniform float uFovX;     // horizontal field of view, radians
uniform float uAspect;   // view width / height
uniform float uVignette; // edge-darkening strength, [0,1]

const float PI = 3.14159265359;

void main(void)
{
    // vTextureCoord is [0,1] over the full-screen sprite (padding 0).
    // NDC in [-1,1]; flip y so screen-up is +pitch.
    vec2 ndc = vTextureCoord * 2.0 - 1.0;

    // Rectilinear (gnomonic) view ray for this pixel.
    float tx = tan(uFovX * 0.5);
    float ty = tx / max(uAspect, 1e-3);
    vec3 dir = normalize(vec3(ndc.x * tx, -ndc.y * ty, 1.0));

    // Yaw the ray by the pan offset (full 360 deg over uPanX in [0,1)).
    float yaw = uPanX * 2.0 * PI;
    float c = cos(yaw);
    float s = sin(yaw);
    vec3 rd = vec3(c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z);

    // View ray -> equirectangular UV.
    float lon = atan(rd.x, rd.z);              // [-PI, PI]
    float lat = asin(clamp(rd.y, -1.0, 1.0));  // [-PI/2, PI/2]
    float u = fract(lon / (2.0 * PI) + 0.5);
    float v = clamp(0.5 - lat / PI, 0.0, 1.0);

    vec3 color = texture(uMapTexture, vec2(u, v)).rgb;

    // Subtle radial vignette composited as a darkening overlay at the edges.
    float vig = 1.0 - uVignette * smoothstep(0.55, 1.45, length(ndc));
    color *= vig;

    finalColor = vec4(color, 1.0);
}
`;

const DEFAULT_FOV_DEGREES = 100;
const DEFAULT_VIGNETTE = 0.5;

export interface PanoramaViewerOptions {
  /** Equirectangular panorama, preferred (already loaded). */
  texture?: Texture;
  /** Manifest URL/path to load lazily via {@link PanoramaViewer.create}. */
  panoramaUrl?: string;
  /** View width in pixels (screen width). */
  width: number;
  /** View height in pixels (screen height). */
  height: number;
  /** Horizontal field of view in degrees. Default 100. */
  fovDegrees?: number;
  /** Edge-vignette strength (0 disables). Default 0.5. */
  vignetteStrength?: number;
}

/** Wrap a pan value into the unit interval [0, 1) (handles negatives). */
export function wrapPan(value: number): number {
  const w = value % 1;
  return w < 0 ? w + 1 : w;
}

export class PanoramaViewer {
  /** Root container — add this to the scene's game layer. */
  public readonly container: Container;
  /** Manifest path the panorama was loaded from, if any (diagnostics only). */
  public readonly panoramaUrl: string | undefined;

  private readonly sprite: Sprite;
  private readonly uniforms: UniformGroup;
  private readonly fovX: number;
  private _panX = 0;
  private _width: number;
  private _height: number;

  private dragging = false;
  private destroyed = false;
  private lastPointerX = 0;
  private readonly onDown: (e: FederatedPointerEvent) => void;
  private readonly onGlobalMove: (e: FederatedPointerEvent) => void;
  private readonly onUp: () => void;

  constructor(options: PanoramaViewerOptions) {
    this._width = options.width;
    this._height = options.height;
    this.fovX = ((options.fovDegrees ?? DEFAULT_FOV_DEGREES) * Math.PI) / 180;
    this.panoramaUrl = options.panoramaUrl;

    const texture = options.texture ?? Texture.EMPTY;
    const source = texture.source;

    this.uniforms = new UniformGroup({
      uPanX: { value: 0, type: "f32" },
      uFovX: { value: this.fovX, type: "f32" },
      uAspect: { value: this._width / Math.max(1, this._height), type: "f32" },
      uVignette: {
        value: options.vignetteStrength ?? DEFAULT_VIGNETTE,
        type: "f32",
      },
    });

    const glProgram = GlProgram.from({
      vertex: VERTEX,
      fragment: FRAGMENT,
      name: "panorama-projection-filter",
    });
    const filter = new Filter({
      glProgram,
      resources: {
        panoramaUniforms: this.uniforms,
        uMapTexture: source,
        uMapSampler: source.style,
      },
    });
    // No padding: vTextureCoord then maps [0,1] exactly over the sprite quad.
    filter.padding = 0;

    // Repeat wrap so the longitude seam scrolls seamlessly (best-effort).
    try {
      const style = source.style as {
        addressMode?: string;
        update?: () => void;
      };
      style.addressMode = "repeat";
      style.update?.();
    } catch {
      /* wrap mode is best-effort */
    }

    // Full-screen sprite gives the filter valid bounds to run over. Its own
    // texture is irrelevant — the shader samples uMapTexture directly.
    this.sprite = new Sprite(texture);
    this.sprite.width = this._width;
    this.sprite.height = this._height;
    this.sprite.filters = [filter];
    this.sprite.eventMode = "static";
    this.sprite.cursor = "grab";

    this.container = new Container();
    this.container.addChild(this.sprite);

    // Self-contained drag-to-look: press to grab, global move to pan, release to
    // drop. globalpointermove keeps tracking even when the pointer leaves the
    // sprite, so a fling never sticks mid-drag.
    this.onDown = (e) => {
      this.dragging = true;
      this.lastPointerX = e.global.x;
      this.sprite.cursor = "grabbing";
    };
    this.onGlobalMove = (e) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.lastPointerX;
      this.lastPointerX = e.global.x;
      // Dragging one screen width pans by one field of view's worth of longitude.
      const fraction =
        -(dx / Math.max(1, this._width)) * (this.fovX / (2 * Math.PI));
      this.panBy(fraction);
    };
    this.onUp = () => {
      this.dragging = false;
      this.sprite.cursor = "grab";
    };
    this.sprite.on("pointerdown", this.onDown);
    this.sprite.on("globalpointermove", this.onGlobalMove);
    this.sprite.on("pointerup", this.onUp);
    this.sprite.on("pointerupoutside", this.onUp);
  }

  /** Current longitude pan, in [0, 1). */
  get panX(): number {
    return this._panX;
  }

  /** Set the absolute longitude pan; value is wrapped into [0, 1). */
  setPanX(value: number): void {
    this._panX = wrapPan(value);
    this.uniforms.uniforms.uPanX = this._panX;
  }

  /** Advance the longitude pan by `deltaFraction`, wrapping at ±1.0. */
  panBy(deltaFraction: number): void {
    this.setPanX(this._panX + deltaFraction);
  }

  /** Resize the view; updates the sprite size and the projection aspect. */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this.sprite.width = width;
    this.sprite.height = height;
    this.uniforms.uniforms.uAspect = width / Math.max(1, height);
  }

  /** Detach handlers and destroy the container (filter included). Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sprite.off("pointerdown", this.onDown);
    this.sprite.off("globalpointermove", this.onGlobalMove);
    this.sprite.off("pointerup", this.onUp);
    this.sprite.off("pointerupoutside", this.onUp);
    this.dragging = false;
    // The panorama is a shared texture-cache entry reused across landings, so it
    // is deliberately not destroyed here; only our display objects + filter are.
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }

  /**
   * Construct asynchronously from a `panoramaUrl`, loading the texture first.
   * Falls back to an empty-texture viewer if the load fails.
   */
  static async create(options: PanoramaViewerOptions): Promise<PanoramaViewer> {
    if (!options.texture && options.panoramaUrl) {
      try {
        const { Assets } = await import("pixi.js");
        const texture = await Assets.load(options.panoramaUrl);
        return new PanoramaViewer({ ...options, texture });
      } catch {
        /* fall through to empty-texture construction */
      }
    }
    return new PanoramaViewer(options);
  }
}

/**
 * Build a {@link PanoramaViewer} for a loaded panorama texture, or return null
 * on any PixiJS API mismatch so the caller can fall back to a flat panorama
 * sprite.
 */
export function createPanoramaViewer(
  options: PanoramaViewerOptions,
): PanoramaViewer | null {
  try {
    return new PanoramaViewer(options);
  } catch {
    return null;
  }
}
