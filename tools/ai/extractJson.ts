/**
 * Shared noisy-JSON extraction for the offline LLM judge / scenario-generator
 * (dev-only, `tools/`-resident). A model reply may be clean JSON, JSON wrapped in
 * a ```json fence, or JSON surrounded by prose; the oddity parser and the scenario
 * parser both need to recover the embedded value the same way, so the routine
 * lives here as the single source of truth instead of being copied into each.
 */

/**
 * Pull the first parseable JSON value out of a possibly-noisy reply. Tries, in
 * order: the whole (trimmed) string, a ```json fenced block, then the widest
 * `{…}`/`[…]` slice. Returns the parsed value or `undefined` — never throws.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed) candidates.push(trimmed);

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const objSlice = sliceBetween(text, "{", "}");
  if (objSlice) candidates.push(objSlice);
  const arrSlice = sliceBetween(text, "[", "]");
  if (arrSlice) candidates.push(arrSlice);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/** The substring from the first `open` to the last `close` (inclusive), or null. */
function sliceBetween(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
