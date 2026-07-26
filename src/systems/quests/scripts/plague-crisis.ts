import type { QuestScript } from "../QuestScript";

// Design: A plague-stricken colony, racing against the vaccine's viability.
// A `time` budget drains with every choice; if it hits zero the colony is lost
// (a `critMin` redirect to ending_too_late — the time-pressure spine).
// Choice points:
//   1. The route — a genuine risk decision, three distinct shapes, not a hidden
//      coin flip:
//        - fast_route (steady hands): the careful shortcut. 70% clean → most
//          time; 30% a clipped hull → costly detour (time + a repair bill).
//        - fast_route_reckless (full burn): the player deliberately doubles the
//          stake. 50% a stunning run (the most time in the game, treat_all with
//          margin); 50% a hard hit (safe-route time PLUS a heavy repair bill).
//        - safe_route (long way): guaranteed, cheap, no repair bill — but never
//          enough time for treat_all. The risk-averse floor that keeps the fast
//          gambles honest instead of strictly dominant.
//      Each field crossing narrates its roll through a distinct beat node
//      (fast_clear_beat/fast_hit_beat, reckless_clear_beat/reckless_hit_beat)
//      rather than a silent auto-jump.
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
            "Через астероидное поле ровным ходом, держась чистых прогалов — минус два часа годности; поле всё равно может выкинуть фокус",
          toLocation: "fast_check",
          effects: ["roll = random(0,9)", "time -= 2"],
        },
        {
          id: "fast_route_reckless",
          label:
            "На форсаже, ва-банк сквозь самую гущу — минус всего час годности, но и секунды на реакцию нет: пройдёте чисто — выиграете уйму времени, ошибётесь — потеряете и часы, и корпус",
          toLocation: "fast_check_reckless",
          effects: ["roll = random(0,9)", "time -= 1"],
        },
        {
          id: "safe_route",
          label:
            "В обход, чистым коридором — надёжно и без единой царапины, но сожжёт шесть часов годности",
          toLocation: "arrival",
          effects: ["time -= 6"],
        },
      ],
    },
    {
      id: "fast_check",
      text: "Глыбы льда и камня несутся навстречу, задевая щиты. Вы ведёте корабль ровно, читая поток и держась прогалов. Один точный манёвр — и вы выиграете драгоценное время. Одна ошибка — и придётся петлять в обломках, теряя час за часом...",
      transitions: [
        {
          id: "fast_clear",
          label: "Чистый проход",
          toLocation: "fast_clear_beat",
          condition: "roll >= 3",
          effects: ["time -= 1"],
          autoExecute: true,
        },
        {
          id: "fast_hit",
          label: "Задели глыбу",
          toLocation: "fast_hit_beat",
          effects: ["time -= 5", "credits -= 600", "rating -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "fast_clear_beat",
      text: "Вы читаете поток камней как открытую книгу — короткий импульс двигателя, и «окно» в поле проскакивает мимо борта. Ни царапины, ни лишней минуты потеряно. Госпиталь уже на радаре.",
      transitions: [
        {
          id: "fast_clear_done",
          label: "К шлюзу госпиталя",
          toLocation: "arrival",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "fast_hit_beat",
      text: "Глыба выныривает из тени слишком поздно. Удар вспарывает обшивку по касательной, щиты воют, и вам приходится петлять в обломках, теряя час за часом. Корабль дотянет, но ремонт после такого влетит в копейку.",
      transitions: [
        {
          id: "fast_hit_done",
          label: "Кое-как — к госпиталю",
          toLocation: "arrival",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "fast_check_reckless",
      text: "Вы вжимаете рычаг тяги до упора и ныряете в самую гущу — на этой скорости поле либо расступится, либо разотрёт вас в труху. Права на ошибку нет, зато если проскочите — выиграете не часы, а сутки.",
      transitions: [
        {
          id: "reckless_clear",
          label: "Проскочили",
          toLocation: "reckless_clear_beat",
          condition: "roll >= 5",
          effects: [],
          autoExecute: true,
        },
        {
          id: "reckless_hit",
          label: "Влетели боком",
          toLocation: "reckless_hit_beat",
          effects: ["time -= 5", "credits -= 1200", "rating -= 12"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "reckless_clear_beat",
      text: "Безумие оправдалось: вы проносите корабль сквозь поле на форсаже, обходя глыбы на волосок. Двигатели пели, обшивка держалась — и вы выигрываете столько времени, сколько не даст ни один осторожный курс. Медики не поверят своим глазам.",
      transitions: [
        {
          id: "reckless_clear_done",
          label: "На всех парах — к госпиталю",
          toLocation: "arrival",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "reckless_hit_beat",
      text: "Скорость не прощает. Корабль влетает боком в каменную реку, обшивку рвёт лоскутами, что-то взрывается в кормовом отсеке. Вы кое-как выправляете курс, но и время, и корпус теперь в клочья — ва-банк не сыграл.",
      transitions: [
        {
          id: "reckless_hit_done",
          label: "На честном слове — к госпиталю",
          toLocation: "arrival",
          effects: [],
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
