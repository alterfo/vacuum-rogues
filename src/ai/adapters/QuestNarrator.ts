import type { ONNXModelRegistry } from "@/ai/ONNXModelRegistry";
import { Tensor } from "onnxruntime-web";
import { logger } from "@/utils/logger";
import type { QuestScript } from "@/systems/quests/QuestScript";

export interface NarratorContext {
  role: string;
  tone: string;
  systemName: string;
  daysSinceStart: number;
}

export interface QuestNarrator {
  narrate(nodeTextKey: string, context: NarratorContext): Promise<string>;
  /** Generate a 1-2 sentence flavour intro for a quest, shown before the first location. */
  narrateQuestIntro(script: QuestScript, planetName: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Template map — one paragraph per quest node textKey
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, (ctx: NarratorContext) => string> = {
  "secret_cargo.intro": (ctx) =>
    `День ${ctx.daysSinceStart}. Система ${ctx.systemName}. ` +
    `Незнакомец в тёмном углу бара протягивает вам контейнер с потёртым серийным номером. ` +
    `«Только доставка,» — говорит он. — «Никаких вопросов. Двойная плата.» ` +
    `Вы ${ctx.role.toLowerCase()}, и подобные предложения — привычное дело.`,

  "secret_cargo.dilemma": (ctx) =>
    `Гиперпрыжок позади. Контейнер лежит в трюме — молчаливый и тяжёлый. ` +
    `Тон ${ctx.tone.toLowerCase()} заставляет вас думать дважды. ` +
    `Что внутри? Запчасти? Наркотики? Или что-то похуже?`,

  "secret_cargo.inspect": (_ctx) =>
    `Замок поддался с тихим щелчком. Внутри — аккуратные пакеты с кристаллами, ` +
    `каждый с маркировкой Бастионов. Явная контрабанда. ` +
    `Теперь у вас проблема — и выбор, как с ней поступить.`,

  "secret_cargo.deliver": (_ctx) =>
    `Получатель открыл дверь, не глядя вам в глаза. Забрал контейнер, отсчитал кредиты. ` +
    `«Ты ничего не видел,» — сказал он. Вы оба знаете, что это неправда.`,

  "secret_cargo.refuse": (_ctx) =>
    `Иногда лучший выбор — не делать никакого. Вы вернули контейнер и ушли, ` +
    `не оглядываясь. Совесть чиста. Кошелёк — нет.`,

  "drifting_ship.scan": (ctx) =>
    `Сканер захватил сигнал в ${ctx.systemName}. Корабль класса «Корвет» — дрейфует без хода, ` +
    `реакторы на нуле. Маяк аварийного спасения мигает третьи сутки. ` +
    `День ${ctx.daysSinceStart}. Вы первые, кто отозвался.`,

  "drifting_ship.board": (_ctx) =>
    `Шлюз открылся с трудом — сервоприводы заморожены. Внутри — полутьма, ` +
    `запах горелой изоляции и... слабый стон из-за переборки. Кто-то выжил.`,

  "drifting_ship.rescue": (_ctx) =>
    `Молодой техник, не старше двадцати. Обморожение, три сломанных ребра — но живой. ` +
    `«Пираты,» — прошептал он. «Забрали всё. Оставили умирать.» ` +
    `Медотсек вашего корабля примет ещё одного пассажира.`,

  "drifting_ship.loot": (_ctx) =>
    `Рубка пуста. Груз — нетронут. Электроника, запчасти, аварийные пайки. ` +
    `Всё это стоит денег. Никто не узнает. Никто, кроме вас.`,

  "drifting_ship.report": (ctx) =>
    `Патруль Бастионов принял координаты через ${ctx.daysSinceStart} дней. ` +
    `«Спасибо, пилот. На счёт будет переведено вознаграждение.» ` +
    `Небольшое. Но честное.`,
};

const FALLBACK_TEMPLATE = (key: string, ctx: NarratorContext): string =>
  `[${ctx.systemName}, день ${ctx.daysSinceStart}] ${key.replace(/[._]/g, " ")}.`;

// ---------------------------------------------------------------------------
// TemplateQuestNarrator — pure synchronous template substitution, no ONNX
// ---------------------------------------------------------------------------

const QUEST_INTRO_TEMPLATES: Record<string, (planet: string) => string> = {
  customs: (p) =>
    `Орбитальная станция ${p}. Таможенный пост третьего уровня — скучная работа до тех пор, пока не объявился первый подозрительный корабль.`,
  "gravity-slalom": (p) =>
    `Учёный с базы ${p} машет вам рукой прямо у шлюза: зонд нужно доставить сейчас, пока гравитационные окна не закрылись.`,
  investigation: (p) =>
    `На складе ${p} нашли тело. Патруль уже оцепил периметр, но найти виновного — дело вашего ума, не их.`,
  "cargo-sort": (p) =>
    `Диспетчер ${p} смотрит на вас с надеждой: пять транспортов на подходе, три дока свободны — и никто не знает, кого куда ставить.`,
  reactor: (p) =>
    `Аварийный сигнал с корабля близ ${p}. Реактор нестабилен. У вас сто двадцать секунд.`,
  auction: (p) =>
    `Аукцион космического лома на станции ${p}. Восемь лотов, несколько жадных покупателей и ваш ограниченный бюджет.`,
};

export class TemplateQuestNarrator implements QuestNarrator {
  async narrate(
    nodeTextKey: string,
    context: NarratorContext,
  ): Promise<string> {
    const fn = TEMPLATES[nodeTextKey];
    return fn ? fn(context) : FALLBACK_TEMPLATE(nodeTextKey, context);
  }

  async narrateQuestIntro(
    script: QuestScript,
    planetName: string,
  ): Promise<string> {
    const fn = QUEST_INTRO_TEMPLATES[script.id];
    return fn
      ? fn(planetName)
      : `${planetName}. Вам предстоит: «${script.title}».`;
  }
}

// ---------------------------------------------------------------------------
// OnnxQuestNarrator — inference via worker with auto-fallback
// ---------------------------------------------------------------------------

const DIALOGUE_MODEL_ID = "t5_dialogue";

function buildPromptTensor(nodeTextKey: string, ctx: NarratorContext): Tensor {
  const prompt = `role:${ctx.role} tone:${ctx.tone} system:${ctx.systemName} day:${ctx.daysSinceStart} node:${nodeTextKey}`;
  const codes = new Float32Array(prompt.length);
  for (let i = 0; i < prompt.length; i++) {
    codes[i] = prompt.charCodeAt(i) / 127;
  }
  return new Tensor("float32", codes, [1, prompt.length]);
}

function tensorToText(tensor: Tensor): string {
  const data = tensor.data as Float32Array;
  return Array.from(data)
    .map((v) => String.fromCharCode(Math.round(Math.abs(v) * 127)))
    .join("")
    .replace(/[^\x20-\x7EЀ-ӿ ]/g, "")
    .trim();
}

export class OnnxQuestNarrator implements QuestNarrator {
  private readonly fallback = new TemplateQuestNarrator();

  constructor(private readonly registry: ONNXModelRegistry) {}

  async narrate(
    nodeTextKey: string,
    context: NarratorContext,
  ): Promise<string> {
    try {
      await this.registry.loadModel(DIALOGUE_MODEL_ID);
      const inputTensor = buildPromptTensor(nodeTextKey, context);
      const outputTensor = await this.registry.infer(
        DIALOGUE_MODEL_ID,
        inputTensor,
      );
      const text = tensorToText(outputTensor);
      if (text.length > 20) {
        return text;
      }
      // Garbage output — fall through to template
    } catch (err) {
      logger.warn(
        "OnnxQuestNarrator: inference failed, using template fallback",
        err,
      );
    }
    return this.fallback.narrate(nodeTextKey, context);
  }

  async narrateQuestIntro(
    script: QuestScript,
    planetName: string,
  ): Promise<string> {
    try {
      await this.registry.loadModel(DIALOGUE_MODEL_ID);
      const prompt = `intro:${script.id} planet:${planetName} title:${script.title}`;
      const codes = new Float32Array(prompt.length);
      for (let i = 0; i < prompt.length; i++) {
        codes[i] = prompt.charCodeAt(i) / 127;
      }
      const inputTensor = new Tensor("float32", codes, [1, prompt.length]);
      const outputTensor = await this.registry.infer(
        DIALOGUE_MODEL_ID,
        inputTensor,
      );
      const text = tensorToText(outputTensor);
      if (text.length > 20) return text;
    } catch (err) {
      logger.warn(
        "OnnxQuestNarrator: intro inference failed, using fallback",
        err,
      );
    }
    return this.fallback.narrateQuestIntro(script, planetName);
  }
}
