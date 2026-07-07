import type { QuestScript } from "../QuestScript";

// Design: A plague-stricken colony, racing against the vaccine's viability.
// A `time` budget drains with every choice; if it hits zero the colony is lost
// (a `critMin` redirect to ending_too_late — the time-pressure spine).
// Choice points:
//   1. The route — the fast asteroid-field shortcut (roll: clean or a costly
//      detour) vs the safe but slow long way around.
//   2. The distribution — triage the salvageable fast, treat EVERYONE (slow,
//      only viable if you arrived early), or hold back doses to profiteer.
// Outcomes:
//   - ending_treat_all (everyone saved in time — big reputation)         SUCCESS
//   - ending_triage    (most saved by triage)                            SUCCESS
//   - ending_profiteer (saved some, but you profited — reputation hit)   SUCCESS
//   - ending_too_late  (vaccine expired, colony devastated)              FAILURE
export const plagueCrisisScript: QuestScript = {
  id: "plague-crisis",
  title: "Эпидемия на колонии",
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
      name: "Срок годности вакцины",
      min: -9999,
      max: 99,
      initial: 10,
      critMin: 1,
      critTarget: "ending_too_late",
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
      text: "«Заря» умирает. Диспетчер колонии не выходит на связь третьи сутки — говорят, лихорадка выкашивает целые кварталы за часы. В грузовом отсеке у вас криоконтейнер с вакциной, единственной на весь сектор. Но ампулы «живут» недолго: индикатор годности уже мигает и медленно опускается.\nСрок годности вакцины: {time}\n\nКаждый час в пути — это доза, которая может не дожить до пациента. Каким курсом идти?",
      transitions: [
        {
          id: "fast_route",
          label:
            "Напрямик через астероидное поле — минус два часа годности, но поле может выкинуть фокус",
          toLocation: "fast_check",
          effects: ["roll = random(0,9)", "time -= 2"],
        },
        {
          id: "safe_route",
          label:
            "В обход, чистым коридором — надёжно, но сожжёт шесть часов годности",
          toLocation: "arrival",
          effects: ["time -= 6"],
        },
      ],
    },
    {
      id: "fast_check",
      text: "Глыбы льда и камня несутся навстречу, задевая щиты. Один точный манёвр — и вы выиграете драгоценное время. Одна ошибка — и придётся петлять в обломках, теряя час за часом...",
      transitions: [
        {
          id: "fast_clear",
          label: "...",
          toLocation: "arrival",
          condition: "roll >= 3",
          effects: ["time -= 1"],
          autoExecute: true,
        },
        {
          id: "fast_hit",
          label: "...",
          toLocation: "arrival",
          effects: ["time -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "arrival",
      text: "Шлюз госпиталя. Внутри — ад: койки в три яруса, стоны, врачи с провалившимися глазами, которые не спали двое суток. Больных сотни, а на индикаторе вакцины осталось совсем немного.\nСрок годности вакцины: {time}\n\nВрачи смотрят на вас и ждут решения. Спасти всех можно только если хватит времени раздать каждую дозу — а его почти нет. Как распорядиться вакциной?",
      transitions: [
        {
          id: "triage",
          label:
            "Сортировка: колоть тех, у кого есть шанс, — быстро, минус два часа. Обречённых придётся отпустить",
          toLocation: "ending_triage",
          effects: ["time -= 2", "credits += 1500", "rating += 15"],
        },
        {
          id: "treat_all",
          label:
            "Лечить всех до единого — минус пять часов. Если вакцина выдохнется на полпути, погибнут все",
          toLocation: "treat_all_outcome",
          effects: ["time -= 5"],
        },
        {
          id: "profiteer",
          label:
            "Часть ампул придержать и продать втридорога — быстро и прибыльно, но люди умрут ради ваших кредитов",
          toLocation: "ending_profiteer",
          effects: ["time -= 2", "credits += 2500", "rating -= 25"],
        },
      ],
    },
    {
      id: "treat_all_outcome",
      text: "Вы раздаёте ампулы всем сразу. Бригады бегут от койки к койке, прививая каждого — старика, ребёнка, того, кого уже почти списали. Индикатор годности падает на глазах, но иглы всё ещё входят в вены, пока держится хоть капля живой вакцины...",
      transitions: [
        {
          id: "all_saved",
          label: "...",
          toLocation: "ending_treat_all",
          effects: ["credits += 2000", "rating += 30"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_treat_all",
      text: "Последняя ампула опустела за минуту до того, как вакцина погибла окончательно. Вы успели. Всех до единого — ни одного савана, ни одной свежей могилы. Колония «Заря» будет рассказывать о вас детям, а врачи жмут вам руку, не стыдясь слёз.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_triage",
      text: "Вы выбирали холодным рассудком: этому — дозу, а этому уже поздно. Большинство выжило, эпидемия сломлена. Но вы навсегда запомните лица тех, мимо кого прошли с пустыми руками. Колония «Заря» жива — и знает цену, которую вы за неё заплатили.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_profiteer",
      text: "Половина ампул ушла перекупщикам — те заплатили не торгуясь, ведь речь шла о жизни. Часть колонистов вы спасли, остальные умерли, пока их дозы лежали в вашем трюме под ценник. Кредиты приятно тяжелы, но в «Заре» ваше имя теперь произносят как проклятье.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_too_late",
      text: "Индикатор погас. Вакцина превратилась в бесполезную мутную взвесь прежде, чем игла коснулась хоть одной вены. Вы бродите по вымершим кварталам «Зари» — ни стонов, ни голосов, только ветер гонит пыль между опустевшими койками. Вы опоздали, и колония заплатила за это всеми своими жизнями.\nСрок годности вакцины: {time}",
      isFailure: true,
      transitions: [],
    },
  ],
};
