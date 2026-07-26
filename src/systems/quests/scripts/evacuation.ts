import type { QuestScript } from "../QuestScript";

// Design: A logistics-routing puzzle under a draining evacuation window. The
// station "Терминус" is minutes from a reactor breach; a `time` budget bleeds
// with every run and, at zero, the core lets go (a `critMin` redirect to
// ending_collapse — the time-pressure spine). The player optimises the ORDER
// and ROUTE of shuttle runs to maximise the `saved` headcount before lift-off.
// Choice points:
//   1. First dock — the med-ring (slow load, few, +rep), the hab-block (fast,
//      many), or the corporate VIP dock (fastest, credits, reputation hit).
//   2. Second run — grab more (costs time) vs bug out now.
//   3. The route home — the fast debris shortcut (roll: clean or snagged) vs
//      the slow clean vector.
// Outcomes (by `saved` at lift-off):
//   - ending_full_evac (≥20 lifted — everyone out, hero)               SUCCESS
//   - ending_partial   (≥10 lifted — most out)                         SUCCESS
//   - ending_few       (<10 lifted — a handful, bittersweet)           SUCCESS
//   - ending_collapse  (window ran out, station breached)              FAILURE
export const evacuationScript: QuestScript = {
  id: "evacuation",
  title: "Эвакуация станции «Терминус»",
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
      id: "time",
      name: "До взрыва реактора",
      min: -9999,
      max: 99,
      initial: 12,
      critMin: 1,
      critTarget: "ending_collapse",
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
  startLocation: "briefing",
  locations: [
    {
      id: "briefing",
      text: "Реактор станции «Терминус» пошёл вразнос. Диспетчер срывающимся голосом отсчитывает минуты до прорыва активной зоны — на индикаторе у вас в кабине то же число.\nДо взрыва реактора: {time}\n\nТри причальных кольца, и на каждом — люди, которые не улетят без вас. За один заход всех не поднять. С кого начать?",
      transitions: [
        {
          id: "dock_medward",
          label:
            "Госпитальное кольцо — лежачих грузят на носилках медленно (−4 часа), но иначе им конец",
          toLocation: "second_run_med",
          effects: ["time -= 4", "saved += 8", "rating += 10"],
        },
        {
          id: "dock_habblock",
          label:
            "Жилой блок — толпа сама бежит по трапам (−2 часа), поднимете разом больше всех",
          toLocation: "second_run_hab",
          effects: ["time -= 2", "saved += 14"],
        },
        {
          id: "dock_vipdock",
          label:
            "Частный причал корпорации — платёжеспособные пассажиры, быстрая швартовка (−1 час), но остальные подождут",
          toLocation: "second_run_vip",
          effects: [
            "time -= 1",
            "saved += 4",
            "credits += 2000",
            "rating -= 15",
          ],
        },
      ],
    },
    {
      id: "second_run_med",
      text: "Госпитальный челнок отвалил, набитый носилками; реаниматологи держат капельницы прямо в проходах. Станцию потряхивает, переборки стонут.\nДо взрыва реактора: {time} | Спасено людей: {saved}\n\nВ жилых секциях ещё бьётся живая толпа. Успеете на ещё один заход — или пора уходить, пока цел трюм?",
      transitions: [
        {
          id: "grab_more",
          label:
            "Ещё один заход за оставшимися — станцию рвёт на части (−3 часа, +8 человек)",
          toLocation: "route_back",
          effects: ["time -= 3", "saved += 8"],
        },
        {
          id: "bug_out",
          label: "Хватит — отчаливать немедленно и уходить к точке прыжка",
          toLocation: "liftoff",
          effects: [],
        },
      ],
    },
    {
      id: "second_run_hab",
      text: "Жилой блок опустел за минуты — трап был забит бегущими телами, челнок ушёл под завязку. Станцию потряхивает, переборки стонут.\nДо взрыва реактора: {time} | Спасено людей: {saved}\n\nНа госпитальном кольце остались те, кто сам не добежит. Успеете на ещё один заход — или пора уходить, пока цел трюм?",
      transitions: [
        {
          id: "grab_more",
          label:
            "Ещё один заход за оставшимися — станцию рвёт на части (−3 часа, +8 человек)",
          toLocation: "route_back",
          effects: ["time -= 3", "saved += 8"],
        },
        {
          id: "bug_out",
          label: "Хватит — отчаливать немедленно и уходить к точке прыжка",
          toLocation: "liftoff",
          effects: [],
        },
      ],
    },
    {
      id: "second_run_vip",
      text: "Частный причал вычищен, платёжеспособные пристёгнуты в мягких креслах и уже требуют кофе. А на общих кольцах ещё колотится в переборки живая масса. Станцию потряхивает, переборки стонут.\nДо взрыва реактора: {time} | Спасено людей: {saved}\n\nСовесть или трюм — успеете на ещё один заход за остальными, или уходить сейчас?",
      transitions: [
        {
          id: "grab_more",
          label:
            "Ещё один заход за оставшимися — станцию рвёт на части (−3 часа, +8 человек)",
          toLocation: "route_back",
          effects: ["time -= 3", "saved += 8"],
        },
        {
          id: "bug_out",
          label: "Хватит — отчаливать немедленно и уходить к точке прыжка",
          toLocation: "liftoff",
          effects: [],
        },
      ],
    },
    {
      id: "route_back",
      text: "Трюм снова полон, люди жмутся у стен. Между вами и открытым космосом — облако вырванных обломков станции. Каким вектором прорываться?",
      transitions: [
        {
          id: "route_fast",
          label:
            "Напрямик сквозь обломки — экономит время (−1 час), но можно и зацепить",
          toLocation: "route_check",
          effects: ["time -= 1", "roll = random(0,9)"],
        },
        {
          id: "route_safe",
          label: "В обход, чистым вектором — надёжно, но долго (−4 часа)",
          toLocation: "liftoff",
          effects: ["time -= 4"],
        },
      ],
    },
    {
      id: "route_check",
      text: "Глыбы обшивки несутся навстречу. Один точный манёвр — и вы выскочите на чистую воду...",
      transitions: [
        {
          id: "route_clear",
          label: "Нить в обломках",
          toLocation: "route_clear_scene",
          condition: "roll >= 3",
          effects: [],
          autoExecute: true,
        },
        {
          id: "route_hit",
          label: "Удар по борту",
          toLocation: "route_hit_scene",
          effects: ["time -= 4"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "route_clear_scene",
      text: "Руки сами ведут корабль по единственной чистой нити сквозь облако — глыбы проносятся в метре от обшивки, и вот перед носом раскрывается открытый космос. Ни царапины. Люди за спиной выдыхают разом.",
      transitions: [
        {
          id: "clear_to_lift",
          label: "К точке прыжка",
          toLocation: "liftoff",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "route_hit_scene",
      text: "Не увернулись: сорванная секция фермы с лязгом вспарывает борт. Корабль встряхивает, гаснет свет, аварийные заслонки бьют по отсекам. На латание пробоины и пересчёт курса уходят драгоценные минуты — время утекает быстрее, чем хотелось бы.",
      transitions: [
        {
          id: "hit_to_lift",
          label: "К точке прыжка",
          toLocation: "liftoff",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "liftoff",
      text: "Точка прыжка. Позади «Терминус» наливается изнутри белым.\nДо взрыва реактора: {time} | Спасено людей: {saved}",
      transitions: [
        {
          id: "lift_hero",
          label: "...",
          toLocation: "ending_full_evac",
          condition: "saved >= 20",
          effects: ["credits += 3000", "rating += 25"],
          autoExecute: true,
        },
        {
          id: "lift_most",
          label: "...",
          toLocation: "ending_partial",
          condition: "saved >= 10",
          effects: ["credits += 1500", "rating += 10"],
          autoExecute: true,
        },
        {
          id: "lift_few",
          label: "...",
          toLocation: "ending_few",
          effects: ["credits += 500"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_full_evac",
      text: "Станция вспыхнула сверхновой за кормой — а в ваших отсеках нет ни одного пустого места. Все до единого. Диспетчер, которого вы вытащили последним рейсом, плачет в переговорник и не может выговорить ни слова благодарности. О рейсе на «Терминус» будут рассказывать в каждом порту сектора.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_partial",
      text: "Вспышка ударила по щитам, когда вы уже уходили в прыжок. Большинство спасено — полные трюмы живых, испуганных, но живых людей. И всё же вы помните тех, до кого не дотянулись: их лица теперь с вами навсегда.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_few",
      text: "Вы успели вывести лишь горстку. Прыжок швырнул корабль прочь за секунду до того, как «Терминус» перестал существовать. Спасённые молчат, глядя в иллюминатор на расширяющееся облако там, где был их дом. Вы сделали, что смогли — но этого было мало.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_collapse",
      text: "Индикатор дошёл до нуля прежде, чем вы отчалили. Реактор «Терминуса» распустился ослепительным цветком, и станция вместе со всеми, кто ещё был на её кольцах, сгинула в одно мгновение. Ударная волна догнала вас у самой точки прыжка — вы ушли, но с пустыми руками и полной памятью.\nДо взрыва реактора: {time}",
      isFailure: true,
      transitions: [],
    },
  ],
};
