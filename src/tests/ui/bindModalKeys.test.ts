import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bindModalKeys } from "@/presentation/ui/bindModalKeys";

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

describe("bindModalKeys", () => {
  let cleanups: Array<() => void>;

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    cleanups.forEach((c) => c());
    document.body.innerHTML = "";
  });

  it("invokes onConfirm on Enter (and not onCancel)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    cleanups.push(bindModalKeys({ onConfirm, onCancel }));

    press({ key: "Enter" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("invokes onCancel on Escape (and not onConfirm)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    cleanups.push(bindModalKeys({ onConfirm, onCancel }));

    press({ key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    cleanups.push(bindModalKeys({ onConfirm, onCancel }));

    press({ key: "a" });
    press({ key: " " });
    press({ key: "j" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cleanup removes the listener (no further callbacks)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const detach = bindModalKeys({ onConfirm, onCancel });

    detach();
    press({ key: "Enter" });
    press({ key: "Escape" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("repeated cleanup is safe / idempotent", () => {
    const onConfirm = vi.fn();
    const detach = bindModalKeys({ onConfirm });

    detach();
    expect(() => detach()).not.toThrow();
    press({ key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("repeated bind/unbind does not leak (only the live binding fires)", () => {
    const stale = vi.fn();
    const live = vi.fn();

    const detachStale = bindModalKeys({ onConfirm: stale });
    detachStale();
    cleanups.push(bindModalKeys({ onConfirm: live }));

    press({ key: "Enter" });

    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter/Esc while a text input is focused", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    cleanups.push(bindModalKeys({ onConfirm, onCancel }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    press({ key: "Enter" });
    press({ key: "Escape" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("drops OS auto-repeat (a held Enter fires confirm once)", () => {
    const onConfirm = vi.fn();
    cleanups.push(bindModalKeys({ onConfirm }));

    press({ key: "Enter" });
    press({ key: "Enter", repeat: true });
    press({ key: "Enter", repeat: true });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("works with only onCancel provided (Enter is a no-op, no throw)", () => {
    const onCancel = vi.fn();
    cleanups.push(bindModalKeys({ onCancel }));

    expect(() => press({ key: "Enter" })).not.toThrow();
    press({ key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
