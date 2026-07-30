import { vi } from "vitest";

// --- Vitest 4 constructor-mock compatibility shim ----------------------------
// Vitest 4's @vitest/spy invokes a mock's implementation via
// `Reflect.construct(impl, args, new.target)` when the mock is called with
// `new`. Arrow functions have no [[Construct]] slot, so `new Container()`
// against a mock defined as `vi.fn().mockImplementation(() => ({ ... }))` now
// throws "... is not a constructor". That idiom backs ~195 inline `pixi.js`
// test mocks that worked under vitest 1, which used the arrow's *return value*
// as the constructed instance. Rather than rewrite every test file, wrap any
// non-constructable implementation in a plain function that forwards to it —
// a plain function IS constructable, and returning an object from a constructor
// makes that object the instance, restoring the vitest-1 semantics exactly.
// (Normal, non-`new` calls are unaffected: the wrapper just forwards.)
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

// Mock Web Worker for jsdom environment
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
