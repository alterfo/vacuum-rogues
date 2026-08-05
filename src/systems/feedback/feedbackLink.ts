export const FEEDBACK_REPO_SLUG = "alterfo/vacuum-rogues-feedback";
export const FEEDBACK_TEMPLATE = "beta-feedback.yml";
export const FEEDBACK_TITLE_PREFIX = "[Beta] ";
export const FEEDBACK_DIAGNOSTICS_FIELD = "diagnostics";

export interface FeedbackContext {
  readonly version: string;
  readonly sha: string;
  readonly scene: string;
  readonly day: number;
  readonly seed: string;
  readonly extras?: ReadonlyArray<readonly [string, string]>;
}

export function formatDiagnostics(ctx: FeedbackContext): string {
  const lines = [
    `version: ${ctx.version}`,
    `sha: ${ctx.sha}`,
    `scene: ${ctx.scene}`,
    `day: ${ctx.day}`,
    `seed: ${ctx.seed}`,
  ];
  if (ctx.extras) {
    for (const [key, value] of ctx.extras) lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

export function buildFeedbackUrl(ctx: FeedbackContext): string {
  const base = `https://github.com/${FEEDBACK_REPO_SLUG}/issues/new`;
  const params: ReadonlyArray<readonly [string, string]> = [
    ["template", FEEDBACK_TEMPLATE],
    ["title", FEEDBACK_TITLE_PREFIX],
    [FEEDBACK_DIAGNOSTICS_FIELD, formatDiagnostics(ctx)],
  ];
  const query = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}?${query}`;
}
