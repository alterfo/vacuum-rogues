import { describe, it, expect, beforeEach } from 'vitest';
import { ECSWorld } from '@/ecs/ECSWorld';
import type { Entity } from '@/ecs/Entity';

describe('ECSWorld', () => {
  let world: ECSWorld;

  beforeEach(() => {
    world = new ECSWorld();
  });

  it('should add and retrieve entities', () => {
    const entity: Entity = { id: 'e1', position: { x: 0, y: 0 } };

    world.addEntity(entity);
    const retrieved = world.getEntity('e1');

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('e1');
  });

  it('should remove entities', () => {
    const entity: Entity = { id: 'e1', position: { x: 0, y: 0 } };

    world.addEntity(entity);
    world.removeEntity('e1');

    expect(world.getEntity('e1')).toBeUndefined();
  });

  it('should query entities by component', () => {
    world.addEntity({ id: 'e1', position: { x: 0, y: 0 } });
    world.addEntity({ id: 'e2', velocity: { x: 1, y: 1 } });
    world.addEntity({ id: 'e3', position: { x: 5, y: 5 }, velocity: { x: 1, y: 1 } });

    const withPosition = world.getEntitiesWith('position');
    expect(withPosition).toHaveLength(2);
    expect(withPosition.map((e) => e.id)).toContain('e1');
    expect(withPosition.map((e) => e.id)).toContain('e3');
  });

  it('should query entities by multiple components (Position + Velocity)', () => {
    world.addEntity({ id: 'e1', position: { x: 0, y: 0 } });
    world.addEntity({ id: 'e2', velocity: { x: 1, y: 1 } });
    world.addEntity({ id: 'e3', position: { x: 5, y: 5 }, velocity: { x: 1, y: 1 } });
    world.addEntity({ id: 'e4', position: { x: 2, y: 2 }, velocity: { x: 2, y: 2 }, health: 100 });

    // Query entities with both position and velocity
    const withPosition = world.getEntitiesWith('position');
    const withVelocity = world.getEntitiesWith('velocity');
    
    // Find intersection
    const withBoth = withPosition.filter((e) => withVelocity.some((v) => v.id === e.id));
    
    expect(withBoth).toHaveLength(2);
    expect(withBoth.map((e) => e.id)).toContain('e3');
    expect(withBoth.map((e) => e.id)).toContain('e4');
  });

  it('should handle component removal (delete entity.velocity)', () => {
    const entity: Entity = { id: 'e1', position: { x: 0, y: 0 }, velocity: { x: 1, y: 1 } };
    world.addEntity(entity);

    // Remove velocity component
    delete entity.velocity;

    const withVelocity = world.getEntitiesWith('velocity');
    const withPosition = world.getEntitiesWith('position');

    expect(withVelocity).toHaveLength(0);
    expect(withPosition).toHaveLength(1);
  });

  it('should execute systems in order', () => {
    const order: string[] = [];

    world.addSystem(() => order.push('A'));
    world.addSystem(() => order.push('B'));
    world.addSystem(() => order.push('C'));

    world.update(16);

    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('should clear all entities and systems', () => {
    world.addEntity({ id: 'e1' });
    world.addSystem(() => void 0);

    world.clear();

    expect(world.getEntity('e1')).toBeUndefined();
    expect(world.getEntitiesWith('any')).toHaveLength(0);
  });

  it('should handle dynamic component addition', () => {
    const entity: Entity = { id: 'e1', position: { x: 0, y: 0 } };
    world.addEntity(entity);

    // Add health component dynamically
    entity.health = 100;

    const withHealth = world.getEntitiesWith('health');
    expect(withHealth).toHaveLength(1);
    expect(withHealth[0].id).toBe('e1');
  });
});
