import { buildFeedbackUrl, type FeedbackContext } from "./feedbackLink";

export type UrlOpener = (url: string, target: string, features: string) => void;

export const openInNewTab: UrlOpener = (url, target, features) => {
  if (typeof window !== "undefined") window.open(url, target, features);
};

export function openFeedback(
  ctx: FeedbackContext,
  open: UrlOpener = openInNewTab,
): void {
  open(buildFeedbackUrl(ctx), "_blank", "noopener");
}
