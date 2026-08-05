export interface ModalKeyHandlers {
  onConfirm?: () => void;
  onCancel?: () => void;
}

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
