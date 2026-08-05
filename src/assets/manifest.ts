const modules = import.meta.glob("./**/*.{png,jpg,jpeg,webp}", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const textures: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const key = path.replace(/^\.\//, "").replace(/\.(png|jpe?g|webp)$/i, "");
  textures[key] = url;
}

export function texture(key: string): string | undefined {
  return textures[key];
}

export function allTextures(category: string): string[] {
  const prefix = `${category}/`;
  return Object.keys(textures).filter((k) => k.startsWith(prefix));
}

export function musicUrl(stateKey: string): string {
  return `/audio/mus_${stateKey}.ogg`;
}
