// The one DOM touchpoint of the beta-feedback flow. `feedbackLink.ts` stays
// pure (URL composition only); this thin wrapper composes that URL and hands it
// to an opener. The opener is injectable so the menu wiring can be unit-tested
// with a fake opener (assert the URL) without a real `window`.

import { buildFeedbackUrl, type FeedbackContext } from "./feedbackLink";

/** Minimal `window.open` shape — the only DOM dependency of the feedback flow. */
export type UrlOpener = (url: string, target: string, features: string) => void;

/**
 * Default opener: a new background tab with `noopener` (no window ref retained,
 * so the GitHub tab cannot script back into the game). Guarded with
 * `typeof window` so a non-DOM runtime (unit tests, SSR) is a silent no-op
 * rather than a ReferenceError.
 */
export const openInNewTab: UrlOpener = (url, target, features) => {
  if (typeof window !== "undefined") window.open(url, target, features);
};

/**
 * Compose the prefilled GitHub Issue Form URL from `ctx` and hand it to `open`
 * (defaults to {@link openInNewTab}). Scenes capture live context and call this;
 * the URL shape is owned solely by {@link buildFeedbackUrl}.
 */
export function openFeedback(
  ctx: FeedbackContext,
  open: UrlOpener = openInNewTab,
): void {
  open(buildFeedbackUrl(ctx), "_blank", "noopener");
}
