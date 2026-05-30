import type { Entity } from './Entity';

export class ECSWorld {
  private entities = new Map<string, Entity>();
  private systems: Array<(entities: Entity[], deltaTime: number) => void> = [];

  addEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
  }

  removeEntity(entityId: string): void {
    this.entities.delete(entityId);
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getEntitiesWith(componentType: string): Entity[] {
    return Array.from(this.entities.values()).filter(
      (e) => e[componentType] !== undefined,
    );
  }

  addSystem(system: (entities: Entity[], deltaTime: number) => void): void {
    this.systems.push(system);
  }

  update(deltaTime: number): void {
    const entityList = Array.from(this.entities.values());
    for (const system of this.systems) {
      system(entityList, deltaTime);
    }
  }

  clear(): void {
    this.entities.clear();
    this.systems = [];
  }
}
