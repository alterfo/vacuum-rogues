import { describe, it, expect } from "vitest";
import { QuestVM } from "@/systems/quests/QuestVM";
import type { QuestScript } from "@/systems/quests/QuestScript";

const basicScript: QuestScript = {
  id: "basic",
  title: "Basic Test Quest",
  params: [
    {
      id: "money",
      name: "Кредиты",
      min: 0,
      max: 9999,
      initial: 500,
      showInUI: true,
    },
    {
      id: "hp",
      name: "Здоровье",
      min: 0,
      max: 100,
      initial: 100,
      critMin: 1,
      critTarget: "dead",
      showInUI: true,
    },
    {
      id: "luck",
      name: "Удача",
      min: 1,
      max: 6,
      initial: "random",
      showInUI: false,
    },
  ],
  startLocation: "start",
  locations: [
    {
      id: "start",
      text: "Вы стоите у входа. Кредиты: {money}. Удача: {luck}.",
      transitions: [
        {
          id: "buy",
          label: "Купить предмет (−200 кр)",
          toLocation: "shop",
          condition: "money >= 200",
          effects: ["money -= 200"],
        },
        { id: "skip", label: "Пропустить", toLocation: "mid", effects: [] },
      ],
    },
    {
      id: "shop",
      text: "Вы купили предмет. Кредиты: {money}.",
      transitions: [
        { id: "proceed", label: "Идти дальше", toLocation: "end", effects: [] },
      ],
    },
    {
      id: "mid",
      text: "Средняя локация.",
      transitions: [
        { id: "finish", label: "Завершить", toLocation: "end", effects: [] },
      ],
    },
    {
      id: "end",
      text: "Вы победили!",
      transitions: [],
      isSuccess: true,
    },
    {
      id: "dead",
      text: "Вы погибли.",
      transitions: [],
      isFailure: true,
    },
  ],
};

describe("QuestVM", () => {
  it("initialises at start location", () => {
    const vm = new QuestVM(basicScript, 42);
    expect(vm.currentLocation().id).toBe("start");
  });

  it("reads initial params correctly", () => {
    const vm = new QuestVM(basicScript, 42);
    expect(vm.getParam("money")).toBe(500);
    expect(vm.getParam("hp")).toBe(100);
  });

  it("random param is reproducible with same seed", () => {
    const vm1 = new QuestVM(basicScript, "test-seed");
    const vm2 = new QuestVM(basicScript, "test-seed");
    expect(vm1.getParam("luck")).toBe(vm2.getParam("luck"));
  });

  it("random param with different seeds may differ", () => {
    const vm1 = new QuestVM(basicScript, "seed-A");
    const vm2 = new QuestVM(basicScript, "seed-B");
    // Values are in range
    expect(vm1.getParam("luck")).toBeGreaterThanOrEqual(1);
    expect(vm1.getParam("luck")).toBeLessThanOrEqual(6);
    expect(vm2.getParam("luck")).toBeGreaterThanOrEqual(1);
    expect(vm2.getParam("luck")).toBeLessThanOrEqual(6);
  });

  it("filters transitions by condition", () => {
    const vm = new QuestVM(basicScript, 42);
    // money=500, so both transitions available
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).toContain("buy");
    expect(ids).toContain("skip");
  });

  it("hides transition when condition not met", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.setParam("money", 100); // below 200
    const ids = vm.availableTransitions().map((t) => t.id);
    expect(ids).not.toContain("buy");
    expect(ids).toContain("skip");
  });

  it("executes transition and applies -= effect", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.execute("buy");
    expect(vm.getParam("money")).toBe(300);
    expect(vm.currentLocation().id).toBe("shop");
  });

  it("follows 3-location path to success", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.execute("skip");
    expect(vm.currentLocation().id).toBe("mid");
    vm.execute("finish");
    expect(vm.currentLocation().id).toBe("end");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(true);
  });

  it("critical threshold triggers forced transition", () => {
    const critScript: QuestScript = {
      id: "crit",
      title: "Crit Test",
      params: [
        {
          id: "hp",
          name: "HP",
          min: 0,
          max: 100,
          initial: 10,
          critMin: 1,
          critTarget: "dead",
          showInUI: true,
        },
      ],
      startLocation: "fight",
      locations: [
        {
          id: "fight",
          text: "HP: {hp}",
          transitions: [
            {
              id: "hit",
              label: "Получить удар",
              toLocation: "fight",
              effects: ["hp -= 15"],
            },
          ],
        },
        { id: "dead", text: "Мёртв", transitions: [], isFailure: true },
      ],
    };
    const vm = new QuestVM(critScript, 1);
    vm.execute("hit"); // hp goes to -5, critMin=1 → jump to dead
    expect(vm.currentLocation().id).toBe("dead");
    expect(vm.isFinished()).toBe(true);
    expect(vm.isSuccess()).toBe(false);
  });

  it("interpolates param values in text", () => {
    const vm = new QuestVM(basicScript, 42);
    const text = vm.interpolate("Кредиты: {money}, HP: {hp}");
    expect(text).toBe("Кредиты: 500, HP: 100");
  });

  it("leaves unknown tokens unchanged in interpolation", () => {
    const vm = new QuestVM(basicScript, 42);
    expect(vm.interpolate("Неизвестно: {unknown}")).toBe(
      "Неизвестно: {unknown}",
    );
  });

  it("evaluate handles all comparison operators", () => {
    const vm = new QuestVM(basicScript, 42);
    // money = 500
    expect(vm.evaluate("money >= 500")).toBe(true);
    expect(vm.evaluate("money >= 501")).toBe(false);
    expect(vm.evaluate("money <= 500")).toBe(true);
    expect(vm.evaluate("money <= 499")).toBe(false);
    expect(vm.evaluate("money == 500")).toBe(true);
    expect(vm.evaluate("money == 501")).toBe(false);
    expect(vm.evaluate("money != 500")).toBe(false);
    expect(vm.evaluate("money != 501")).toBe(true);
    expect(vm.evaluate("money > 499")).toBe(true);
    expect(vm.evaluate("money > 500")).toBe(false);
    expect(vm.evaluate("money < 501")).toBe(true);
    expect(vm.evaluate("money < 500")).toBe(false);
  });

  it("applyEffect handles compound assignments", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.applyEffect("money += 100");
    expect(vm.getParam("money")).toBe(600);
    vm.applyEffect("money -= 50");
    expect(vm.getParam("money")).toBe(550);
    vm.applyEffect("money *= 2");
    expect(vm.getParam("money")).toBe(1100);
    vm.applyEffect("money /= 2");
    expect(vm.getParam("money")).toBe(550);
  });

  it("applyEffect handles expression assignment", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.applyEffect("money = money * 2");
    expect(vm.getParam("money")).toBe(1000);
  });

  it("applyEffect handles simple assignment", () => {
    const vm = new QuestVM(basicScript, 42);
    vm.applyEffect("money = 999");
    expect(vm.getParam("money")).toBe(999);
  });

  it("applyEffect handles random assignment", () => {
    const vm = new QuestVM(basicScript, "rng-seed");
    vm.applyEffect("hp = random(1,20)");
    const val = vm.getParam("hp");
    expect(val).toBeGreaterThanOrEqual(1);
    expect(val).toBeLessThanOrEqual(20);
  });

  it("random effect is reproducible with same seed", () => {
    const vm1 = new QuestVM(basicScript, "same-seed");
    const vm2 = new QuestVM(basicScript, "same-seed");
    vm1.applyEffect("hp = random(1,100)");
    vm2.applyEffect("hp = random(1,100)");
    expect(vm1.getParam("hp")).toBe(vm2.getParam("hp"));
  });
});
