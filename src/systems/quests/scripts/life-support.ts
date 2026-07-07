import type { QuestScript } from "../QuestScript";

// Design: A resource-optimisation puzzle with a hard, non-renewable budget.
// A crippled liner is venting atmosphere; the scrubbers are dead and there are
// only {oxygen} units of reserve air left. Repressurising each sealed section
// costs oxygen and saves the people trapped inside — the player must ALLOCATE a
// fixed budget to save the most (`saved`). If the reserve hits zero mid-op the
// remaining sections decompress explosively (a `critMin` redirect to
// ending_suffocate — the budget floor). Distinct from plague-crisis (that is a
// TIME budget); here the scarce resource is air itself.
// Choice points:
//   1. First section to repressurise — the bridge (2, cheap), the packed cargo
//      hold (6, expensive), or engineering (2, cheap, the repair console).
//   2. Restart the scrubber (roll: +5 air on success, −2 on failure) vs conserve.
//   3. The last section — spend the remaining air to save them (+6) vs seal it
//      off and guarantee the survivors you already have.
// Outcomes (by `saved`):
//   - ending_all_survive (>=10 — everyone breathes)                     SUCCESS
//   - ending_most        (>=6 — most saved)                             SUCCESS
//   - ending_few         (<6 — a handful, hard choices)                 SUCCESS
//   - ending_suffocate   (reserve blew mid-op, mass decompression)      FAILURE
export const lifeSupportScript: QuestScript = {
  id: "life-support",
  title: "Кислородный расчёт",
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
      id: "oxygen",
      name: "Резерв воздуха",
      min: -9999,
      max: 99,
      initial: 10,
      critMin: 1,
      critTarget: "ending_suffocate",
      showInUI: true,
    },
    {
      id: "saved",
      name: "Спасено людей",
      min: 0,
      max: 999,
      initial: 0,
      showInUI: true,
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
  startLocation: "scene",
  locations: [
    {
      id: "scene",
      text: "Пассажирский лайнер «Тихая гавань» получил пробоину и травит атмосферу в пустоту. Скрубберы мертвы, регенерации нет — только то, что осталось в аварийных баллонах.\nРезерв воздуха: {oxygen}\n\nТри загерметизированных отсека колотят в переборки, задыхаясь. Наддуть все сразу воздуха не хватит. Куда пустить его первым?",
      transitions: [
        {
          id: "air_bridge",
          label:
            "В рубку — там двое пилотов, без них корабль не увести (−3 воздуха, +2 спасённых)",
          toLocation: "allocate2",
          effects: ["oxygen -= 3", "saved += 2", "rating += 5"],
        },
        {
          id: "air_hold",
          label:
            "В грузовой отсек — шестеро пассажиров уже теряют сознание (−6 воздуха, +6)",
          toLocation: "allocate2",
          effects: ["oxygen -= 6", "saved += 6"],
        },
        {
          id: "air_eng",
          label:
            "В инженерный — там вы, механик и пульт ремонта скруббера (−2 воздуха, +2)",
          toLocation: "allocate2",
          effects: ["oxygen -= 2", "saved += 2"],
        },
      ],
    },
    {
      id: "allocate2",
      text: "Первый отсек наддут, в нём снова дышат. Но резерв тает на глазах.\nРезерв воздуха: {oxygen} | Спасено людей: {saved}\n\nМожно рискнуть перезапуском скруббера — если оживёт, воздуха хватит на всех. А можно не искушать судьбу и беречь остаток.",
      transitions: [
        {
          id: "fix_scrubber",
          label:
            "Перезапустить скруббер — продувка стоит воздуха (−1), но при удаче даст +5",
          toLocation: "scrubber_check",
          effects: ["oxygen -= 1", "roll = random(0,9)"],
        },
        {
          id: "skip_repair",
          label: "Не рисковать — беречь каждый литр остатка",
          toLocation: "final_seal",
          effects: [],
        },
      ],
    },
    {
      id: "scrubber_check",
      text: "Реле щёлкает, турбина скруббера тяжело проворачивается, кашляет...",
      transitions: [
        {
          id: "scrub_ok",
          label: "...",
          toLocation: "final_seal",
          condition: "roll >= 5",
          effects: ["oxygen += 5"],
          autoExecute: true,
        },
        {
          id: "scrub_fail",
          label: "...",
          toLocation: "final_seal",
          effects: ["oxygen -= 2"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "final_seal",
      text: "Остался последний запертый отсек — и в нём тоже люди, стучат в стекло переборки.\nРезерв воздуха: {oxygen} | Спасено людей: {saved}\n\nНаддуть его — спасти всех, если воздуха хватит? Или загерметизировать и уйти, гарантированно сохранив тех, кто уже дышит?",
      transitions: [
        {
          id: "save_last",
          label:
            "Пустить воздух в последний отсек — спасти всех, если резерв выдержит (−5, +6)",
          toLocation: "tally",
          effects: ["oxygen -= 5", "saved += 6"],
        },
        {
          id: "seal_last",
          label:
            "Загерметизировать его и увести корабль — те, кто внутри, обречены, но остальные точно доживут",
          toLocation: "tally",
          effects: ["rating -= 10"],
        },
      ],
    },
    {
      id: "tally",
      text: "Двигатели ожили, «Тихая гавань» ковыляет к спасательному коридору. Пора считать, кого удалось вытащить.\nРезерв воздуха: {oxygen} | Спасено людей: {saved}",
      transitions: [
        {
          id: "tally_all",
          label: "...",
          toLocation: "ending_all_survive",
          condition: "saved >= 10",
          effects: ["credits += 3000", "rating += 25"],
          autoExecute: true,
        },
        {
          id: "tally_most",
          label: "...",
          toLocation: "ending_most",
          condition: "saved >= 6",
          effects: ["credits += 1500", "rating += 10"],
          autoExecute: true,
        },
        {
          id: "tally_few",
          label: "...",
          toLocation: "ending_few",
          effects: ["credits += 500"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_all_survive",
      text: "Спасательные буксиры приняли лайнер, и по трапам сошли все до единого — бледные, дрожащие, но живые. Вы распорядились каждым литром так, что не потеряли никого. Капитан «Тихой гавани» отдаёт вам честь, а спасённые ещё долго будут вспоминать пилота, который умел считать воздух жизнями.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_most",
      text: "Большинство спасено — полные шлюзы живых людей. Резерва хватило почти на всех, и «почти» — это те, кого вы не смогли достать вовремя. Вы сделали трудный, но правильный расчёт, и корабль дошёл.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_few",
      text: "Вы вытащили горстку — тех, за кого хватило воздуха. Загерметизированный отсек остался за спиной тёмным и тихим. Спасённые не смотрят вам в глаза, и вы их понимаете: где-то за переборкой остались те, кому не досталось ни литра.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_suffocate",
      text: "Стрелка резерва легла на ноль в самый неподходящий момент. Не наддутые до конца переборки не выдержали перепада — и отсеки один за другим разошлись с оглушительным хлопком, выхлестнув воздух и людей в пустоту. Вы увели искалеченный корабль, но спасать в нём было уже некого.\nРезерв воздуха: {oxygen}",
      isFailure: true,
      transitions: [],
    },
  ],
};
