import { describe, it, expect } from 'vitest';
import { TradeSystem } from '@/systems/TradeSystem';
import { Market } from '@/domain/Market';
import { Planet } from '@/domain/Planet';
import { Player } from '@/domain/Player';
import { PlayerShip } from '@/domain/PlayerShip';
import { Inventory } from '@/domain/Inventory';
import { Race } from '@/domain/Race';
import { SkillTree } from '@/domain/SkillTree';
import { GameBusinessException } from '@/exceptions/GameBusinessException';
import type { QuestLog, Journal, ResourceType } from '@/types';

describe('TradeSystem', () => {
  function createMockPlayer(credits = 1000): Player {
    const race = new Race(
      'HUMAN' as import('@/types').RaceType,
      'Human',
      {},
      { id: 'mech', description: '' },
      { tone: 'neutral', formality: 0.5, verbosity: 0.5 },
      { hullHP: 100, shields: 50, energy: 100, speed: 10, evasion: 5 },
      { buyMultiplier: 1.0, sellMultiplier: 1.1 },
    );
    return new Player(
      'p1',
      'TestPilot',
      race,
      0,
      1,
      new SkillTree([]),
      {},
      { activeQuests: [], completedQuests: [] } as QuestLog,
      { entries: [] } as Journal,
      credits,
      new PlayerShip('ship1', 'TestShip', 100, 100, 50, 50, 100, 100, 10, 5, race),
      new Inventory(),
    );
  }

  function createMockPlanet(): Planet {
    const planet = new Planet(
      'pl1',
      'TestPlanet',
      'INDUSTRIAL' as import('@/types').PlanetType,
      new Market({} as Planet, ['FUEL' as ResourceType, 'METALS' as ResourceType], [1.0, 1.0], [1.0, 1.0]),
      [],
      [],
    );
    // Fix circular reference: market expects planet reference
    (planet.market as unknown as { planet: Planet }).planet = planet;
    return planet;
  }

  describe('calculatePrice', () => {
    const trade = new TradeSystem();

    it('should calculate exact formula: basePrice=100, demand=1.5, supply=0.8 → 188', () => {
      const price = trade.calculatePrice(100, 1.5, 0.8);
      expect(price).toBe(188); // Math.round(100 * 1.5 / 0.8) = Math.round(187.5) = 188
    });

    it('should handle supply = 1, demand = 1 → price equals base', () => {
      const price = trade.calculatePrice(100, 1.0, 1.0);
      expect(price).toBe(100);
    });

    it('should increase price when demand > supply', () => {
      const price = trade.calculatePrice(100, 2.0, 0.5);
      expect(price).toBe(400); // 100 * 2.0 / 0.5 = 400
    });

    it('should decrease price when supply > demand', () => {
      const price = trade.calculatePrice(100, 0.5, 2.0);
      expect(price).toBe(25); // 100 * 0.5 / 2.0 = 25
    });

    it('should throw GameBusinessException for negative basePrice', () => {
      expect(() => trade.calculatePrice(-100, 1.0, 1.0)).toThrow(GameBusinessException);
      try {
        trade.calculatePrice(-100, 1.0, 1.0);
      } catch (error) {
        expect((error as GameBusinessException).errorCode).toBe('INVALID_BASE_PRICE');
      }
    });

    it('should handle very small supply (clamped to 0.01)', () => {
      const price = trade.calculatePrice(100, 1.0, 0.001);
      expect(price).toBe(10000); // 100 * 1.0 / 0.01 = 10000
    });
  });

  it('should calculate market price within guardrails', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer();

    const price = trade.getMarketPrice(planet, 'FUEL' as ResourceType, player);
    const basePrice = 50;

    expect(price).toBeGreaterThanOrEqual(basePrice * 0.3);
    expect(price).toBeLessThanOrEqual(basePrice * 3.0);
  });

  it('should execute buy transaction and deduct credits', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(1000);

    const result = trade.executeTrade(player, planet, 'FUEL' as ResourceType, 5, true);

    expect(result.success).toBe(true);
    expect(player.credits).toBeLessThan(1000);
    expect(player.inventory.resources.some((r) => r.type === ('FUEL' as ResourceType) && r.amount === 5)).toBe(true);
  });

  it('should reject buy if insufficient credits', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(10);

    const result = trade.executeTrade(player, planet, 'FUEL' as ResourceType, 100, true);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Insufficient');
  });

  it('should execute sell transaction and add credits with racial bonus', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(1000);
    player.inventory.resources.push({ type: 'FUEL' as ResourceType, amount: 100 });

    const result = trade.executeTrade(player, planet, 'FUEL' as ResourceType, 10, false);

    expect(result.success).toBe(true);
    expect(player.credits).toBeGreaterThan(1000);
  });

  it('should reject sell if insufficient resources', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(1000);

    const result = trade.executeTrade(player, planet, 'FUEL' as ResourceType, 10, false);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not enough');
  });

  it('should reject negative amount with GameBusinessException', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(1000);

    expect(() => trade.executeTrade(player, planet, 'FUEL' as ResourceType, -5, true)).toThrow(GameBusinessException);
    try {
      trade.executeTrade(player, planet, 'FUEL' as ResourceType, -5, true);
    } catch (error) {
      expect((error as GameBusinessException).errorCode).toBe('INVALID_TRADE_AMOUNT');
    }
  });

  it('should reject zero amount with GameBusinessException', () => {
    const trade = new TradeSystem();
    const planet = createMockPlanet();
    const player = createMockPlayer(1000);

    expect(() => trade.executeTrade(player, planet, 'FUEL' as ResourceType, 0, true)).toThrow(GameBusinessException);
  });
});
