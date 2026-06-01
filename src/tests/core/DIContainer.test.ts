import { describe, it, expect, beforeEach } from "vitest";
import { DIContainer } from "@/core/DIContainer";

describe("DIContainer", () => {
  beforeEach(() => {
    DIContainer.reset();
  });

  it("should be a singleton", () => {
    const c1 = DIContainer.getInstance();
    const c2 = DIContainer.getInstance();
    expect(c1).toBe(c2);
  });

  it("should register and resolve a service", () => {
    const container = DIContainer.getInstance();
    const service = { name: "TestService" };

    container.register("TestService", service);
    const resolved = container.resolve<{ name: string }>("TestService");

    expect(resolved.name).toBe("TestService");
  });

  it("should throw when resolving unregistered service", () => {
    const container = DIContainer.getInstance();
    expect(() => container.resolve("Unknown")).toThrow(
      'DIContainer: Service "Unknown" is not registered.',
    );
  });

  it("should check if service is registered", () => {
    const container = DIContainer.getInstance();
    container.register("Known", 42);

    expect(container.has("Known")).toBe(true);
    expect(container.has("Unknown")).toBe(false);
  });

  it("should resolve singleton only once", () => {
    const container = DIContainer.getInstance();
    let counter = 0;

    const factory = () => {
      counter++;
      return { id: counter };
    };

    const s1 = container.resolveSingleton("Counter", factory);
    const s2 = container.resolveSingleton("Counter", factory);

    expect(s1.id).toBe(1);
    expect(s2.id).toBe(1);
    expect(counter).toBe(1);
  });

  it("should reset instance", () => {
    const c1 = DIContainer.getInstance();
    c1.register("Key", "value");

    DIContainer.reset();
    const c2 = DIContainer.getInstance();

    expect(c2.has("Key")).toBe(false);
    expect(c1).not.toBe(c2);
  });
});
