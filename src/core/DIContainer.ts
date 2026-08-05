export class DIContainer {
  private static instance: DIContainer | null = null;
  private readonly services = new Map<string, unknown>();

  private constructor() {}

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  static reset(): void {
    DIContainer.instance = null;
  }

  register<T>(token: string, implementation: T): void {
    this.services.set(token, implementation);
  }

  resolve<T>(token: string): T {
    const service = this.services.get(token);
    if (service === undefined) {
      throw new Error(`DIContainer: Service "${token}" is not registered.`);
    }
    return service as T;
  }

  has(token: string): boolean {
    return this.services.has(token);
  }

  resolveSingleton<T>(token: string, factory: () => T): T {
    if (!this.services.has(token)) {
      this.register(token, factory());
    }
    return this.resolve<T>(token);
  }
}
