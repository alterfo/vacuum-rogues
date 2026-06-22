/**
 * Planet sphere-rotation filter (ART Task 7 / US-075).
 *
 * A GLSL {@link Filter} that paints a rotating planet from an equirectangular
 * surface map. The fragment shader maps each disc pixel through the orthographic
 * projection of a sphere's front hemisphere back to equirectangular UV, samples
 * the supplied surface map, clips to a circular mask, applies limb darkening for
 * volume and a subtle atmosphere rim-light at the edge. Axial rotation is the
 * `uOffset` longitude uniform, advanced each frame by {@link advance}.
 *
 * Applied to a flat square Sprite sized to the planet's diameter; the filter
 * samples the *original* map texture (`uMapTexture`) directly rather than the
 * re-rendered sprite, so the projection is independent of filter padding.
 *
 * Pure-presentation helper. Construction is guarded by
 * {@link createPlanetRotationFilter} so callers can fall back to a textured
 * sphere mesh on any PixiJS API mismatch (e.g. a WebGPU-only renderer, since we
 * only ship a WebGL program).
 */
import { Filter, GlProgram, Texture, UniformGroup } from "pixi.js";

// Standard PixiJS v8 filter vertex shader (matches the built-in default) plus a
// `vPos` varying: aPosition spans [0,1] over the filter quad (= the sprite's
// bounds, padding 0 + clipToViewport false), which is what the fragment stage
// needs for disc-local coords. vTextureCoord CANNOT be used for that: the filter
// input texture is pooled (power-of-two), so vTextureCoord only reaches
// frame/pooled-size `k < 1` and a disc derived from it is mis-scaled — planets
// rendered as corner-flooded rectangles (letsplay F1).
const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vPos;

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
    vPos = aPosition;
}
`;

const FRAGMENT = `in vec2 vTextureCoord;
in vec2 vPos;
out vec4 finalColor;

uniform sampler2D uTexture;     // filter input (unused — kept for the binding)
uniform sampler2D uMapTexture;  // equirectangular surface map

uniform float uOffset;    // longitude scroll, [0,1)
uniform float uRim;       // atmosphere rim-light strength
uniform vec2  uLightDir;  // screen-space unit direction planet -> star

const float PI = 3.14159265359;
// Dim fill on the night side (starlight / atmospheric scatter) so the shadowed
// hemisphere reads as shaded, never pitch black.
const float NIGHT_AMBIENT = 0.2;

void main(void)
{
    // Disc-local coords from vPos: aPosition is [0,1] over the square sprite
    // (padding 0, clipToViewport off). NOT vTextureCoord — the pooled input
    // texture makes its range frame-dependent (k < 1), which mis-scales the
    // disc clip, limb darkening and rim-light (letsplay F1: rectangles).
    vec2 p = (vPos - 0.5) * 2.0;              // [-1, 1]
    float r = length(p);
    if (r > 1.0) {
        discard;                              // outside the planet disc
    }

    // Orthographic projection of a sphere's front hemisphere -> equirect UV.
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float cosLat = max(cos(lat), 1e-3);
    float lon = asin(clamp(p.x / cosLat, -1.0, 1.0));

    // Front hemisphere (+/-90 deg longitude) spans half the 360 deg map width;
    // uOffset slides that window to spin the planet on its axis.
    float u = fract(lon / (2.0 * PI) + uOffset);
    float v = clamp(lat / PI + 0.5, 0.0, 1.0);

    vec4 surf = texture(uMapTexture, vec2(u, v));

    // Limb darkening toward the edge gives the disc volume.
    float shade = mix(1.0, 0.55, smoothstep(0.55, 1.0, r));

    // Star-direction terminator (day/night). The disc point p is also the (x, y)
    // of the front-hemisphere sphere normal n = (p.x, p.y, sqrt(1 - r^2)); the
    // star lies in the screen plane (z = 0), so the diffuse term reduces to
    // dot(n, vec3(uLightDir, 0)) = dot(p, uLightDir). A smooth band softens the
    // terminator and the night side keeps NIGHT_AMBIENT fill. The band is biased
    // a touch toward the dark side so the disc centre still reads as lit rather
    // than sitting exactly on the terminator.
    float ndotl = dot(p, uLightDir);
    float day = smoothstep(-0.35, 0.30, ndotl);
    float light = mix(NIGHT_AMBIENT, 1.0, day);
    vec3 color = surf.rgb * shade * light;

    // Subtle blue atmosphere rim-light, only on the lit limb facing the star.
    float rim = smoothstep(0.86, 1.0, r) * uRim * day;
    color += vec3(0.40, 0.58, 1.0) * rim;

    // Anti-aliased circular edge (premultiplied output).
    float edge = 1.0 - smoothstep(0.985, 1.0, r);
    finalColor = vec4(color * edge, edge);
}
`;

export interface PlanetRotationFilterOptions {
  /** Equirectangular surface map, preferred (already loaded). */
  texture?: Texture;
  /** Manifest URL/path to load lazily via {@link PlanetRotationFilter.create}. */
  texturePath?: string;
  /** Longitude fraction advanced per millisecond; wraps at 1.0. May be negative. */
  rotationSpeed: number;
  /** Atmosphere rim-light intensity (0 disables). Default 0.35. */
  rimStrength?: number;
}

/** Wrap a value into the unit interval [0, 1) (handles negatives). */
export function wrapUnit(value: number): number {
  const w = value % 1;
  return w < 0 ? w + 1 : w;
}

export class PlanetRotationFilter extends Filter {
  /** Longitude fraction advanced per millisecond (wraps at 1.0). */
  public readonly rotationSpeed: number;
  /** Manifest path the map was loaded from, if any (diagnostics only). */
  public readonly texturePath: string | undefined;
  private readonly planetUniforms: UniformGroup;
  private _offset = 0;
  // Screen-space unit direction planet -> star, mirrored onto the uLightDir
  // uniform. Mutated in place so the GPU upload always reads current values.
  private readonly _lightDir = new Float32Array([1, 0]);

  constructor(options: PlanetRotationFilterOptions) {
    const texture = options.texture ?? Texture.EMPTY;
    const source = texture.source;
    const planetUniforms = new UniformGroup({
      uOffset: { value: 0, type: "f32" },
      uRim: { value: options.rimStrength ?? 0.35, type: "f32" },
      uLightDir: { value: new Float32Array([1, 0]), type: "vec2<f32>" },
    });
    const glProgram = GlProgram.from({
      vertex: VERTEX,
      fragment: FRAGMENT,
      name: "planet-rotation-filter",
    });
    super({
      glProgram,
      resources: {
        planetUniforms,
        uMapTexture: source,
        uMapSampler: source.style,
      },
      // Never clip the filter frame to the viewport: vPos must span [0,1] over
      // the FULL sprite square even when the planet is partially offscreen,
      // otherwise the disc projection would distort at the screen edges.
      clipToViewport: false,
    });
    // No padding: aPosition (vPos) then maps [0,1] exactly over the sprite square.
    this.padding = 0;
    this.planetUniforms = planetUniforms;
    this.rotationSpeed = options.rotationSpeed;
    this.texturePath = options.texturePath;

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
  }

  /** Current longitude offset, in [0, 1). */
  get offset(): number {
    return this._offset;
  }

  /**
   * Advance the axial rotation by `deltaMs` milliseconds: increments the
   * `uOffset` longitude uniform by `rotationSpeed * deltaMs`, wrapping into
   * [0, 1).
   */
  advance(deltaMs: number): void {
    this._offset = wrapUnit(this._offset + this.rotationSpeed * deltaMs);
    this.planetUniforms.uniforms.uOffset = this._offset;
  }

  /** Current screen-space light direction `[x, y]` (unit vector toward the star). */
  get lightDir(): readonly [number, number] {
    return [this._lightDir[0], this._lightDir[1]];
  }

  /**
   * Point the day/night terminator at the star: normalize the screen-space
   * planet→star vector `(dx, dy)` and write it into the `uLightDir` uniform so
   * the lit hemisphere faces the star. A zero-length vector (planet exactly on
   * the star) is ignored so the last good direction is retained. Independent of
   * {@link advance} — the surface still spins under a fixed sun.
   */
  setLightDirection(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    this._lightDir[0] = dx / len;
    this._lightDir[1] = dy / len;
    this.planetUniforms.uniforms.uLightDir = this._lightDir;
  }

  /**
   * Construct asynchronously from a `texturePath`, loading the map first. Falls
   * back to a path-less filter (Texture.EMPTY) if the load fails.
   */
  static async create(
    options: PlanetRotationFilterOptions,
  ): Promise<PlanetRotationFilter> {
    if (!options.texture && options.texturePath) {
      try {
        const { Assets } = await import("pixi.js");
        const texture = await Assets.load(options.texturePath);
        return new PlanetRotationFilter({ ...options, texture });
      } catch {
        /* fall through to path-less construction */
      }
    }
    return new PlanetRotationFilter(options);
  }
}

/**
 * Build a {@link PlanetRotationFilter} for a loaded equirectangular map, or
 * return null on any PixiJS API mismatch so the caller can fall back to a
 * textured sphere mesh / flat scroll.
 */
export function createPlanetRotationFilter(
  texture: Texture,
  rotationSpeed: number,
  rimStrength?: number,
): PlanetRotationFilter | null {
  try {
    return new PlanetRotationFilter({ texture, rotationSpeed, rimStrength });
  } catch {
    return null;
  }
}
