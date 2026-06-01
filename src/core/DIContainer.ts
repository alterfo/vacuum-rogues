/**
 * Lightweight Dependency Injection Container.
 * Follows GRASP Indirection: central registry for service resolution.
 * Follows Singleton pattern: one container per application lifecycle.
 */
export class DIContainer {
  private static instance: DIContainer | null = null;
  private readonly services = new Map<string, unknown>();

  private constructor() {}

  /**
   * Get the singleton instance.
   */
  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  /**
   * Reset the singleton (useful for testing).
   */
  static reset(): void {
    DIContainer.instance = null;
  }

  /**
   * Register a service implementation.
   */
  register<T>(token: string, implementation: T): void {
    this.services.set(token, implementation);
  }

  /**
   * Resolve a service by token.
   * @throws Error if service not registered.
   */
  resolve<T>(token: string): T {
    const service = this.services.get(token);
    if (service === undefined) {
      throw new Error(`DIContainer: Service "${token}" is not registered.`);
    }
    return service as T;
  }

  /**
   * Check if a service is registered.
   */
  has(token: string): boolean {
    return this.services.has(token);
  }

  /**
   * Resolve or create a singleton.
   */
  resolveSingleton<T>(token: string, factory: () => T): T {
    if (!this.services.has(token)) {
      this.register(token, factory());
    }
    return this.resolve<T>(token);
  }
}
