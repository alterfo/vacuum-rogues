// Pure composer for the prefilled GitHub Issue Form URL used by the in-game
// «Сообщить отзыв» button. No PixiJS/DOM — scenes only capture context and call
// `window.open(buildFeedbackUrl(ctx), "_blank", "noopener")`.
//
// GitHub Issue Forms accept query-param prefill: `?template=<file>` selects the
// form and each `<field id>=<value>` prefills that field. We prefill the
// dedicated `diagnostics` field (id matches `.github/ISSUE_TEMPLATE/
// beta-feedback.yml`) so every report is reproducible without asking the tester
// for build/scene/seed details.

/** Owner/name slug of the GitHub repo issues are filed against. Public, issues-only
 * tracker (the game repo is private — a private slug 404s for external testers). */
export const FEEDBACK_REPO_SLUG = "alterfo/vacuum-rogues-feedback";
/** Issue Form template file selected via the `template` query param. */
export const FEEDBACK_TEMPLATE = "beta-feedback.yml";
/** Title prefix the form already defaults to; re-asserted via the URL. */
export const FEEDBACK_TITLE_PREFIX = "[Beta] ";
/** Field `id` of the prefilled diagnostics textarea in the Issue Form. */
export const FEEDBACK_DIAGNOSTICS_FIELD = "diagnostics";

/** Live build + runtime context captured at the moment the tester clicks. */
export interface FeedbackContext {
  readonly version: string;
  readonly sha: string;
  readonly scene: string;
  readonly day: number;
  readonly seed: string;
}

/**
 * Multi-line plain-text body for the diagnostics field. Key order mirrors the
 * form's placeholder so a tester sees the same shape they expect.
 */
export function formatDiagnostics(ctx: FeedbackContext): string {
  return [
    `version: ${ctx.version}`,
    `sha: ${ctx.sha}`,
    `scene: ${ctx.scene}`,
    `day: ${ctx.day}`,
    `seed: ${ctx.seed}`,
  ].join("\n");
}

/**
 * Compose the prefilled new-issue URL:
 * `https://github.com/<slug>/issues/new?template=…&title=…&diagnostics=…`.
 * Every value is percent-encoded (spaces → `%20`, newlines → `%0A`, Cyrillic →
 * UTF-8 percent-octets) so the diagnostics survive an unchanged form submission.
 */
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
