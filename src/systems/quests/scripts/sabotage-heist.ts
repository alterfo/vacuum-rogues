import type { QuestScript } from "../QuestScript";

// Design: A vault heist on the Hyperion corporate station, with a betrayal branch.
// Two+ meaningful choice points:
//   1. How to get in — bribe your inside contact Векслер (costs cr, gains a
//      partner), hack the security grid (roll: clean or loud — each with its own
//      narrated beat), or force the airlock (loud).
//   2. What to grab — the full haul (more loot, but louder/slower) vs the data
//      core only (lighter, quieter).
//   3. The exit — meet Векслер to split the loot (he may BETRAY you on a roll),
//      double-cross him (keep everything, lose reputation), or slip out. Slipping
//      out WITH a partner is not free: he keeps the cases he was carrying, so you
//      lose part of the haul (bringing a partner genuinely changes this exit).
//      A high alarm level gets you caught regardless.
// Outcomes:
//   - ending_clean         (escaped with the loot)                       SUCCESS
//   - ending_double_cross  (ditched the partner: more loot, −rep)        SUCCESS
//   - ending_betrayed      (partner took the loot and ran)               FAILURE
//   - ending_caught        (alarm too high, security caught you)         FAILURE
export const sabotageHeistScript: QuestScript = {
  id: "sabotage-heist",
  title: "Налёт на хранилище",
  params: [
    {
      id: "credits",
      name: "Кредиты",
      min: -9999,
      max: 99999,
      initial: 0,
      showInUI: true,
    },
    {
      id: "rating",
      name: "Репутация",
      min: -9999,
      max: 300,
      initial: 100,
      showInUI: true,
    },
    {
      id: "alarm",
      name: "Тревога",
      min: -9999,
      max: 99,
      initial: 0,
      showInUI: true,
    },
    {
      id: "loot",
      name: "Добыча",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: true,
    },
    {
      id: "partner",
      name: "Напарник",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "crossed",
      name: "Предал напарника",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "roll",
      name: "Бросок",
      min: 0,
      max: 9,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "approach",
  locations: [
    {
      id: "approach",
      text: "Корпоративная станция «Гиперион» висит в тени газового гиганта, холодная и безмолвная. Где-то в её нутре, за метровой бронёй, спит дата-ядро с чужими секретами и кейсы с кредитами. Сигнализация взведена и ждёт одной вашей ошибки.\n\nКак проникнуть внутрь?",
      transitions: [
        {
          id: "bribe_contact",
          label:
            "Подкупить своего человека — техника Векслера с внутренней смены (−500 кр, пойдёт с вами в долю)",
          toLocation: "inside",
          effects: ["credits -= 500", "partner = 1"],
        },
        {
          id: "hack_grid",
          label: "Вскрыть сеть охраны — обмануть датчики (как повезёт)",
          toLocation: "hack_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "force_airlock",
          label: "Сорвать шлюз домкратом — быстро, но на весь отсек",
          toLocation: "inside",
          effects: ["alarm += 4"],
        },
      ],
    },
    {
      id: "hack_check",
      text: "Курсор грызёт слой за слоем. Один экран сменяется другим, красные счётчики доступа падают к нулю. Ещё немного...",
      transitions: [
        {
          id: "hack_clean",
          label: "...",
          toLocation: "hacked_clean",
          condition: "roll >= 4",
          effects: [],
          autoExecute: true,
        },
        {
          id: "hack_loud",
          label: "...",
          toLocation: "hacked_loud",
          effects: ["alarm += 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "hacked_clean",
      text: "Последний контур сдаётся беззвучно. На пульте охраны — ровные зелёные строки, ваш взлом лёг поверх штатного лога так, что и не отличишь. Датчики честно докладывают: всё спокойно. Замки хранилища мягко расходятся перед вами.",
      transitions: [
        {
          id: "clean_to_inside",
          label: "Внутрь",
          toLocation: "inside",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "hacked_loud",
      text: "Одна подпись не сошлась — и сеть огрызается. Где-то по переборкам прокатывается короткий сигнал тревоги, на пультах вспыхивает янтарь. Замки всё же поддаются, но теперь станция знает, что в неё влезли чужие.\nТревога: {alarm}",
      transitions: [
        {
          id: "loud_to_inside",
          label: "Внутрь, пока не поздно",
          toLocation: "inside",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "inside",
      text: "Вы внутри. Воздух в хранилище холоден и неподвижен, стеллажи гудят на низкой ноте. Вот оно — дата-ядро в противоударном контейнере, а рядом кейсы с кредитами. Где-то по коридору мерно топает патрульный: у вас минуты, не больше.\nТревога: {alarm}\n\nЧто забрать?",
      transitions: [
        {
          id: "grab_all",
          label: "Грести всё — ядро и кредиты, плевать на шум и на секунды",
          toLocation: "escape_decision",
          effects: ["loot += 5", "alarm += 3"],
        },
        {
          id: "grab_core",
          label: "Взять только дата-ядро — налегке и тихо",
          toLocation: "escape_decision",
          effects: ["loot += 3"],
        },
      ],
    },
    {
      id: "escape_decision",
      text: "Груз у вас в руках, сердце колотится в такт далёкому топоту охраны. Каждая лишняя секунда здесь — приговор. Пора уходить.\nТревога: {alarm} | Добыча: {loot}\n\nКак выбираться?",
      transitions: [
        {
          id: "meet_partner",
          label: "Идти к напарнику и честно делить добычу",
          toLocation: "partner_meet",
          condition: "partner == 1",
          effects: [],
        },
        {
          id: "double_cross",
          label: "Кинуть напарника — уйти другим шлюзом со всей добычей",
          toLocation: "escape_gate",
          condition: "partner == 1",
          effects: ["crossed = 1", "rating -= 20"],
        },
        {
          id: "slip_out_partner",
          label:
            "Уйти в одиночку тем же путём — не искать Векслера (он оставит себе кейсы, что нёс)",
          toLocation: "escape_gate",
          condition: "partner == 1",
          effects: ["loot -= 2"],
        },
        {
          id: "slip_out",
          label: "Тихо ускользнуть тем же путём, что и вошли",
          toLocation: "escape_gate",
          condition: "partner == 0",
          effects: [],
        },
      ],
    },
    {
      id: "partner_meet",
      text: "Векслер ждёт у грузового челнока, двигатель уже прогрет и мелко дрожит. За смену он успел рассказать вам про больную мать на Окраине и про долг, из-за которого и пошёл на это дело, — а теперь встречает вас той самой улыбкой, которой не стоит верить. «Всё чисто? Давай сюда, поделим по-братски, как договаривались».",
      transitions: [
        {
          id: "trust_partner",
          label: "Отдать кейсы Векслеру на делёж",
          toLocation: "trust_check",
          effects: ["roll = random(0,9)"],
        },
      ],
    },
    {
      id: "trust_check",
      text: "Векслер принимает кейсы, взвешивает их в руках — и медленно поворачивается к люку челнока. За секунду в его глазах успевает мелькнуть и долг, и мать, и то, сколько всего можно купить на вашу долю. Одно мгновение решает всё...",
      transitions: [
        {
          id: "betrayed",
          label: "...",
          toLocation: "ending_betrayed",
          condition: "roll <= 3",
          effects: ["loot = 0", "rating -= 10"],
          autoExecute: true,
        },
        {
          id: "honored",
          label: "...",
          toLocation: "escape_gate",
          effects: ["loot -= 1", "rating += 10"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "escape_gate",
      text: "Вы срываетесь к выходу. Коридор мелькает мимо, впереди — спасительный шлюз, а за спиной нарастает вой...",
      transitions: [
        {
          id: "caught",
          label: "...",
          toLocation: "ending_caught",
          condition: "alarm >= 6",
          effects: [],
          autoExecute: true,
        },
        {
          id: "clear",
          label: "...",
          toLocation: "payout_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "payout_gate",
      text: "В тени дальнего дока скупщик поворачивает добычу под тусклой лампой, оценивая каждую цифру...",
      transitions: [
        {
          id: "pay_big",
          label: "...",
          toLocation: "disposition_gate",
          condition: "loot >= 5",
          effects: ["credits += 4000"],
          autoExecute: true,
        },
        {
          id: "pay_mid",
          label: "...",
          toLocation: "disposition_gate",
          condition: "loot >= 3",
          effects: ["credits += 2500"],
          autoExecute: true,
        },
        {
          id: "pay_small",
          label: "...",
          toLocation: "disposition_gate",
          effects: ["credits += 1000"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "disposition_gate",
      text: "Кредиты на счету, «Гиперион» тает за кормой. Остаётся один вопрос — с чем вы уходите...",
      transitions: [
        {
          id: "was_crossed",
          label: "...",
          toLocation: "ending_double_cross",
          condition: "crossed == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "clean_exit",
          label: "...",
          toLocation: "ending_clean",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_clean",
      text: "Шлюз смыкается за спиной, и вы растворяетесь в потоке кораблей — с добычей на борту и без единой царапины на репутации. Сигнализация так и не поняла, кого ей искать. Чистая работа.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_double_cross",
      text: "Напарник ещё стоит у пустого челнока и клянёт вас на чём свет стоит, а вы уже далеко — со всей добычей до последнего кейса. Кошелёк потяжелел, но в тени станций отныне шепчут: этому руку не подавай.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_betrayed",
      text: "Люк челнока с лязгом захлопывается перед вашим носом, двигатели вспыхивают — и напарник уходит в темноту со всей добычей. Та самая улыбка не обманула. Вас провели, как новичка.\nКредиты: {credits} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_caught",
      text: "Сигнализация срывается в сплошной вой, красные огни заливают коридор. Бронированные створки шлюзов падают одна за другой, и охрана берёт вас с поличным, добыча ещё в руках. Налёт провален.\nТревога: {alarm}",
      isFailure: true,
      transitions: [],
    },
  ],
};
