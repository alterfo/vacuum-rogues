import { Filter, GlProgram, Texture, UniformGroup } from "pixi.js";

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
  texture?: Texture;
  texturePath?: string;
  rotationSpeed: number;
  rimStrength?: number;
}

export function wrapUnit(value: number): number {
  const w = value % 1;
  return w < 0 ? w + 1 : w;
}

export class PlanetRotationFilter extends Filter {
  public readonly rotationSpeed: number;
  public readonly texturePath: string | undefined;
  private readonly planetUniforms: UniformGroup;
  private _offset = 0;
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
      clipToViewport: false,
    });
    this.padding = 0;
    this.planetUniforms = planetUniforms;
    this.rotationSpeed = options.rotationSpeed;
    this.texturePath = options.texturePath;

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

  get offset(): number {
    return this._offset;
  }

  advance(deltaMs: number): void {
    this._offset = wrapUnit(this._offset + this.rotationSpeed * deltaMs);
    this.planetUniforms.uniforms.uOffset = this._offset;
  }

  get lightDir(): readonly [number, number] {
    return [this._lightDir[0], this._lightDir[1]];
  }

  setLightDirection(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    this._lightDir[0] = dx / len;
    this._lightDir[1] = dy / len;
    this.planetUniforms.uniforms.uLightDir = this._lightDir;
  }

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
