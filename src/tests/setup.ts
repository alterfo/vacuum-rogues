import { vi } from "vitest";

type AnyFn = (...args: unknown[]) => unknown;

function toConstructable<T>(impl: T): T {
  if (
    typeof impl === "function" &&
    (impl as { prototype?: unknown }).prototype === undefined
  ) {
    const inner = impl as unknown as AnyFn;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      return inner.apply(this, args);
    };
    return wrapped as unknown as T;
  }
  return impl;
}

const originalViFn = vi.fn.bind(vi) as typeof vi.fn;
vi.fn = ((impl?: AnyFn) => {
  const mock = (
    impl !== undefined ? originalViFn(toConstructable(impl)) : originalViFn()
  ) as ReturnType<typeof vi.fn>;
  const origImpl = mock.mockImplementation.bind(mock);
  mock.mockImplementation = ((fn: AnyFn) =>
    origImpl(toConstructable(fn))) as typeof mock.mockImplementation;
  const origOnce = mock.mockImplementationOnce.bind(mock);
  mock.mockImplementationOnce = ((fn: AnyFn) =>
    origOnce(toConstructable(fn))) as typeof mock.mockImplementationOnce;
  return mock;
}) as typeof vi.fn;

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;

  constructor(_scriptURL: string, _options?: { type?: "module" }) {
    // Mock constructor
  }

  postMessage(_data: unknown): void {
    // Mock method
  }

  terminate(): void {
    // Mock method
  }
}

// @ts-expect-error - Mock Worker for jsdom
global.Worker = MockWorker;
