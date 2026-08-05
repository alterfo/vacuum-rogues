import { describe, it, expect, vi, afterEach } from "vitest";
import {
  wheelDirection,
  attachWheelScroll,
} from "@/presentation/ui/WheelScroll";

describe("wheelDirection", () => {
  it("maps positive deltaY (scroll down) to +1", () => {
    expect(wheelDirection(100)).toBe(1);
    expect(wheelDirection(0.5)).toBe(1);
  });

  it("maps negative deltaY (scroll up) to -1", () => {
    expect(wheelDirection(-100)).toBe(-1);
    expect(wheelDirection(-0.5)).toBe(-1);
  });

  it("maps zero deltaY to 0 (no scroll)", () => {
    expect(wheelDirection(0)).toBe(0);
  });
});

describe("attachWheelScroll", () => {
  const listeners = new Map<EventListener, AddEventListenerOptions | boolean>();

  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  function stubWindow() {
    const added: EventListener[] = [];
    const removed: EventListener[] = [];
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, handler, opts) => {
        if (String(type) === "wheel") {
          added.push(handler as EventListener);
          listeners.set(
            handler as EventListener,
            opts as AddEventListenerOptions,
          );
        }
      },
    );
    vi.spyOn(window, "removeEventListener").mockImplementation(
      (type, handler) => {
        if (String(type) === "wheel") removed.push(handler as EventListener);
      },
    );
    return { added, removed };
  }

  it("registers a passive:false wheel listener and detaches it", () => {
    const { added, removed } = stubWindow();
    const detach = attachWheelScroll(vi.fn());
    expect(added).toHaveLength(1);
    expect(listeners.get(added[0])).toEqual({ passive: false });
    detach();
    expect(removed).toEqual([added[0]]);
  });

  it("invokes onScroll with the direction and prevents default for non-zero deltas", () => {
    const { added } = stubWindow();
    const onScroll = vi.fn();
    attachWheelScroll(onScroll);
    const handler = added[0] as (e: WheelEvent) => void;

    const downEvent = { deltaY: 120, preventDefault: vi.fn() };
    handler(downEvent as unknown as WheelEvent);
    expect(onScroll).toHaveBeenCalledWith(1);
    expect(downEvent.preventDefault).toHaveBeenCalled();

    const upEvent = { deltaY: -120, preventDefault: vi.fn() };
    handler(upEvent as unknown as WheelEvent);
    expect(onScroll).toHaveBeenCalledWith(-1);
    expect(upEvent.preventDefault).toHaveBeenCalled();
  });

  it("ignores zero-delta events (no callback, no preventDefault)", () => {
    const { added } = stubWindow();
    const onScroll = vi.fn();
    attachWheelScroll(onScroll);
    const handler = added[0] as (e: WheelEvent) => void;

    const flat = { deltaY: 0, preventDefault: vi.fn() };
    handler(flat as unknown as WheelEvent);
    expect(onScroll).not.toHaveBeenCalled();
    expect(flat.preventDefault).not.toHaveBeenCalled();
  });
});
