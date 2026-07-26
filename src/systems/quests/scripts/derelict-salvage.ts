import type { QuestScript } from "../QuestScript";

// Design: Salvage mystery aboard the drifting freighter «Морвен».
// Three meaningful choice points, all of which surface in the endings:
//   1. How to board — dock carefully (full cargo) vs force a breach (damaged
//      cargo). The breach is called out in the reported-clean ending.
//   2. What to do in the hold — seal the dangerous bio-container (`sealed`) vs
//      extract the bio-sample (`sample`) for extra credits but at outbreak risk.
//      Sealing is no longer a dead flag: an intact, sealed class-IV container
//      fetches a fat black-market premium (at a steep reputation cost).
//   3. Final disposition — report to authorities vs sell on the black market.
// Outcomes:
//   - ending_report            (clean report, +rep, official bounty)         SUCCESS
//   - ending_report_forced     (clean report after a scorched breach)        SUCCESS
//   - ending_sample_seized     (reported with the sample → confiscated+fine)  SUCCESS
//   - ending_blackmarket       (sold the haul, more credits, −rep)           SUCCESS
//   - ending_blackmarket_sealed(fenced the intact sealed container, −−rep)    SUCCESS
//   - ending_outbreak          (sold the bio-sample → spores escape + ruin)   FAILURE
export const derelictSalvageScript: QuestScript = {
  id: "derelict-salvage",
  title: "Дрейфующий сухогруз",
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
      id: "forced",
      name: "Грубый вход",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "sample",
      name: "Биообразец",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
    {
      id: "sealed",
      name: "Загерметизировано",
      min: 0,
      max: 1,
      initial: 0,
      showInUI: false,
    },
  ],
  startLocation: "approach",
  locations: [
    {
      id: "approach",
      text: "Сухогруз «Морвен» дрейфует бортом к вам, тёмный и немой на всех частотах. Только красный огонёк аварийного питания ползёт по обшивке — ни ответа на запрос, ни признака жизни. Стыковочный узел цел и ждёт, но прожечь переборку выйдет вдвое быстрее.\n\nКак подняться на борт?",
      transitions: [
        {
          id: "dock_careful",
          label: "Состыковаться через шлюз — медленно, но груз цел",
          toLocation: "bridge",
          effects: [],
        },
        {
          id: "force_entry",
          label: "Прожечь переборку — быстро, но резаком по грузу",
          toLocation: "breach",
          effects: ["forced = 1"],
        },
      ],
    },
    {
      id: "bridge",
      text: "Мостик «Морвена» затянут инеем — реголит стужи на каждом пульте, дыхание клубится паром. Кресла пусты, ремни расстёгнуты в спешке. Бортжурнал мигает последней записью и обрывается на полуслове: «...оно вырвалось из стазиса. Всем в трюм, задраить...». Дальше — тишина. Экипажа нигде нет.",
      transitions: [
        {
          id: "explore_hold_b",
          label: "Спуститься в трюм — туда, куда бежал экипаж",
          toLocation: "hold_inspect",
          effects: [],
        },
        {
          id: "go_cargo_b",
          label: "Сразу к грузовому отсеку — не искушать судьбу",
          toLocation: "cargo_gate",
          effects: [],
        },
      ],
    },
    {
      id: "breach",
      text: "Резак выгрызает в переборке рваную дыру, и вы вваливаетесь внутрь по остывающему металлу. Корабль мёртв и тих, как склеп. Воздух спёртый, застоялый; фонарь выхватывает из темноты капли замёрзшего конденсата на трубах. Времени в обрез.",
      transitions: [
        {
          id: "explore_hold_c",
          label: "Осмотреть трюм — что там случилось?",
          toLocation: "hold_inspect",
          effects: [],
        },
        {
          id: "go_cargo_c",
          label: "К грузовому отсеку — забрать своё и уходить",
          toLocation: "cargo_gate",
          effects: [],
        },
      ],
    },
    {
      id: "hold_inspect",
      text: "В центре трюма — стазис-контейнер размером с гроб, весь в жёлтых наклейках: «БИОЛОГИЧЕСКАЯ ОПАСНОСТЬ. КЛАСС IV. НЕ ВСКРЫВАТЬ». По корпусу ползёт трещина, из неё тянется тонкий иней. За мутным стеклом что-то медленно, слепо шевелится. Споры пока спят. Но трещина растёт на глазах.",
      transitions: [
        {
          id: "seal_it",
          label: "Заварить трещину и загерметизировать контейнер",
          toLocation: "cargo_gate",
          effects: ["sealed = 1"],
        },
        {
          id: "take_sample",
          label: "Вскрыть и извлечь биообразец — за него дадут целое состояние",
          toLocation: "cargo_gate",
          effects: ["sample = 1", "credits += 1000"],
        },
      ],
    },
    // Cargo condition depends on how we boarded.
    {
      id: "cargo_gate",
      text: "Путь к грузовому отсеку...",
      transitions: [
        {
          id: "cg_damaged",
          label: "Груз повреждён прожигом",
          toLocation: "cargo_damaged",
          condition: "forced == 1",
          effects: [],
          autoExecute: true,
        },
        {
          id: "cg_full",
          label: "Груз цел",
          toLocation: "cargo_full",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "cargo_full",
      text: "Грузовой отсек нетронут — аккуратная стыковка того стоила. Ряды опечатанных контейнеров с редкими сплавами стоят как новенькие. Отличная добыча, всё до последнего слитка.",
      transitions: [
        {
          id: "load_full",
          label: "Перегрузить весь груз к себе",
          toLocation: "final_decision",
          effects: ["credits += 3000"],
        },
      ],
    },
    {
      id: "cargo_damaged",
      text: "Прожжённая переборка обошлась дорого: резак вскрыл соседние контейнеры, сплавы спеклись и осыпались. Уцелело меньше половины груза — за спешку всегда платят.",
      transitions: [
        {
          id: "load_damaged",
          label: "Собрать то, что уцелело",
          toLocation: "final_decision",
          effects: ["credits += 2000"],
        },
      ],
    },
    {
      id: "final_decision",
      text: "«Морвен» остаётся за кормой, трюм полон, двигатели гудят ровно. Добыча ваша. Кредиты: {credits}.\n\nТеперь решается главное: сдать находку по закону за честную премию — или уйти в тень, где платят больше и не задают вопросов.",
      transitions: [
        {
          id: "report",
          label: "Сдать властям — чистые руки, официальная премия",
          toLocation: "report_gate",
          effects: [],
        },
        {
          id: "blackmarket",
          label: "Сбыть на чёрном рынке — больше денег, никаких вопросов",
          toLocation: "blackmarket_gate",
          effects: [],
        },
      ],
    },
    {
      id: "report_gate",
      text: "Вы стыкуетесь со станцией флота. Диспетчер вызывает досмотровую команду, и по трапу поднимаются офицеры со сканерами...",
      transitions: [
        {
          id: "rg_seized",
          label: "Сканеры находят образец",
          toLocation: "ending_sample_seized",
          condition: "sample == 1",
          effects: ["credits -= 500"],
          autoExecute: true,
        },
        {
          id: "rg_clean_forced",
          label: "Досмотр чист, но борт вскрыт резаком",
          toLocation: "ending_report_forced",
          condition: "forced == 1",
          effects: ["credits += 1000", "rating += 40"],
          autoExecute: true,
        },
        {
          id: "rg_clean",
          label: "Досмотр чист",
          toLocation: "ending_report",
          effects: ["credits += 1000", "rating += 40"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "blackmarket_gate",
      text: "Тёмный док на окраине системы, ни огней, ни камер. Скупщик встречает вас широкой, ничего не значащей улыбкой и жестом приглашает показать товар...",
      transitions: [
        {
          id: "bg_outbreak",
          label: "Контейнер не выдержал",
          toLocation: "ending_outbreak",
          condition: "sample == 1",
          effects: ["rating -= 60", "credits -= 3000"],
          autoExecute: true,
        },
        {
          id: "bg_sold_sealed",
          label: "Целый контейнер уходит с наценкой",
          toLocation: "ending_blackmarket_sealed",
          condition: "sealed == 1",
          effects: ["credits += 3500", "rating -= 45"],
          autoExecute: true,
        },
        {
          id: "bg_sold",
          label: "Сделка закрыта",
          toLocation: "ending_blackmarket",
          effects: ["credits += 2500", "rating -= 30"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_report",
      text: "Вы сдали груз и контейнер флоту в целости — карантинщики увозят его под конвоем, и где-то там всё же будут искать пропавший экипаж «Морвена». Командир жмёт вам руку: находка и честность зачтены. Официальная премия на счету, ваше имя произносят с уважением.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_report_forced",
      text: "Флотский досмотр не находит заразы — вы вынесли с «Морвена» только груз, всё чисто. Но офицер долго водит сканером по оплавленным краям прожжённой вами переборки и хмурится: на борт вы вошли не через шлюз, а резаком, и часть груза за это поплатилась. Премию платят — за честность и находку, — но взгляд у командира куда холоднее, чем к тем, кто стыкуется как положено.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_sample_seized",
      text: "Сканеры на трапе взвыли на первой же секунде: вы вынесли с «Морвена» вскрытый биообразец. Карантинная служба в защитных костюмах изымает пробирку и выписывает крупный штраф за перевозку заразы класса IV. Вас отчитывают, но признают, что вы всё же явились сами — дело закрывают.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_blackmarket",
      text: "Скупщик, не переставая улыбаться, пересчитывает груз и отсыпает вам пачку кредитов — больше, чем дал бы любой флот. Сплавы «Морвена» растворяются в тени без следа, и вы уходите с полными карманами. Вот только слухи о том, чем вы приторговываете в тёмных доках, теперь бегут впереди вас.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_blackmarket_sealed",
      text: "Вы даже не вскрывали контейнер — и скупщик это ценит: целую, опечатанную капсулу класса IV можно перепродать втридорога тем, кто не побрезгует. Он отсыпает вам щедрую пачку сверх обычного, любовно поглаживая жёлтые наклейки. Груз «Морвена» и смертельный сосуд растворяются в тени. Вот только слух, что вы теперь барыжите целыми биоконтейнерами, а не простой рудой, липнет к вашему имени намертво — от таких шарахаются даже в тёмных доках.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_outbreak",
      text: "Скупщик тянется к пробирке — и в тот же миг понимает то же, что и вы: трещина не держит. Стекло лопается, споры вырываются облаком прямо посреди тёмного дока. Улыбка сползает с его лица навсегда. К утру весь сектор станции задыхается в карантинных мигалках, док выжигают дотла — вместе со всей вашей добычей, брошенной у трапа, — а ваше имя первой строкой идёт в розыск. Карантинная служба вешает на вас счёт за дезактивацию, какого не покрыть и десятью такими рейсами. Именно этого экипаж «Морвена» и пытался не допустить ценой жизни.\nКатастрофа. Кредиты: {credits} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
