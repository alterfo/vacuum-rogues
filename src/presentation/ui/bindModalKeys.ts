/**
 * Shared modal keyboard convention: **Enter confirms, Esc cancels.**
 *
 * Modals/panels across the game each bound their own ad-hoc `keydown` listener
 * (some closed on Esc, none confirmed on Enter). This is the one source of truth
 * for that convention so every modal reuses one implementation instead of copying
 * a window listener (low blast radius). Mirrors the detach-on-close pattern of
 * `attachWheelScroll` (`WheelScroll.ts`): the caller invokes the returned cleanup
 * in `destroy()`/close so listeners don't stack across scene transitions.
 *
 * Intentionally for a modal's *single* primary action — not multi-button forms.
 * Keys are ignored while a text field is focused (so typing into an input keeps
 * Enter/Esc) and OS auto-repeat is dropped (a held key fires the action once).
 */

export interface ModalKeyHandlers {
  /** Primary/confirm action — fired on Enter. Omit for close-only modals. */
  onConfirm?: () => void;
  /** Cancel/close action — fired on Esc. Omit for confirm-only prompts. */
  onCancel?: () => void;
}

/**
 * True when the focused element is a text-entry surface (input/textarea/select or
 * a contenteditable). While such an element holds focus the modal must not steal
 * Enter/Esc — the field's own handling wins.
 */
function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

/**
 * Attach a window-level `keydown` listener mapping Enter→`onConfirm` and
 * Esc→`onCancel`. Returns a cleanup fn that removes the listener; the cleanup is
 * idempotent (repeated calls are safe no-ops), so repeated bind/unbind can't leak.
 */
export function bindModalKeys({
  onConfirm,
  onCancel,
}: ModalKeyHandlers): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.repeat) return; // drop OS auto-repeat (held key acts once)
    if (isTextInputFocused()) return; // let a focused field keep Enter/Esc
    if (event.key === "Enter" && onConfirm) {
      event.preventDefault();
      onConfirm();
    } else if ((event.key === "Escape" || event.key === "Esc") && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  window.addEventListener("keydown", handler);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    window.removeEventListener("keydown", handler);
  };
}
