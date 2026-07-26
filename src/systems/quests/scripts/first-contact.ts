import type { QuestScript } from "../QuestScript";

// Design: First contact with an unknown alien vessel. Diplomacy with clear
// peace vs hostility outcomes, driven by an alien-`trust` meter.
// Choice points:
//   1. The opening — broadcast a peace greeting (safe +trust), run an active scan
//      (a gamble: on a curious roll it yields sellable xeno-intel (+credits) but
//      no diplomatic edge; on an alarmed roll it drops you into a standoff), or
//      raise shields (−trust, leads to a standoff). Broadcast buys the better
//      diplomatic ceiling; scan trades that ceiling for material intel at real risk.
//   2. The follow-up — reciprocate a gift (+trust), accept warily (small +trust),
//      or make demands (−trust); from a standoff: stand down (+trust), hold aim
//      or fire a warning shot (−trust, risks war). The exchange scene branches per
//      how you got there: generous reciprocation, one-sided taking, extortion under
//      posturing, or a tense de-escalation from aimed guns — each its own beat, all
//      funnelling into the same trust-keyed resolution_gate.
// Peaceful endings are SUCCESS, hostile endings are FAILURE.
//   - ending_alliance      (high trust → alliance, big reward)           SUCCESS
//   - ending_trade_pact    (mid trust → trade pact)                      SUCCESS
//   - ending_wary_peace    (low trust → uneasy peace)                    SUCCESS
//   - ending_cold_standoff (they leave wary, no relations)               FAILURE
//   - ending_war           (provoked them into hostilities)              FAILURE
export const firstContactScript: QuestScript = {
  id: "first-contact",
  title: "Первый контакт",
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
      id: "trust",
      name: "Доверие",
      min: -9999,
      max: 99,
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
  startLocation: "encounter",
  locations: [
    {
      id: "encounter",
      text: "Из тени газового гиганта выплывает нечто, чью форму глаз отказывается держать: грани складываются не туда, где им положено быть, и корпус будто дышит. Ни сигнатуры, ни опознавательных кодов — только ровный, нечеловечески спокойный гул на всех частотах. На мостике тихо; кто-то уже положил ладонь на пульт орудий. Приборы не понимают, что перед вами. Не понимаете и вы.\nДоверие: {trust}\n\nПервый жест будет решающим. Как вы ответите?",
      transitions: [
        {
          id: "broadcast",
          label: "Передать мирное приветствие — открытые частоты, ладони пусты",
          toLocation: "greeting",
          effects: ["trust += 2"],
        },
        {
          id: "scan",
          label:
            "Прощупать корпус активным сканером — риск, что это примут за прицеливание",
          toLocation: "scan_reaction",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "raise_shields",
          label: "Поднять щиты и взять чужака на прицел",
          toLocation: "standoff",
          effects: ["trust -= 3"],
        },
      ],
    },
    {
      id: "greeting",
      text: "Ответ приходит переливом тонов — будто кто-то поёт математику. В пустоте между кораблями разворачивается голограмма: спираль, звезда, две ладони, тянущиеся друг к другу. Затем из корпуса бесшумно отделяется крохотный артефакт и повисает на полпути к вам — дар, оставленный на ваше усмотрение. Напряжение на мостике спадает на полдыхания. Это приглашение. Ответить нужно так же ясно.",
      transitions: [
        {
          id: "reciprocate",
          label: "Ответить даром — отправить им частицу нашего мира",
          toLocation: "exchange_gift",
          effects: ["trust += 4"],
        },
        {
          id: "accept_wary",
          label: "Забрать дар молча, ничего не предложив в ответ",
          toLocation: "exchange_take",
          effects: ["trust += 1"],
        },
        {
          id: "demand_tech",
          label: "Потребовать взамен их технологии — по-нашему, с позиции силы",
          toLocation: "exchange_demand",
          effects: ["trust -= 4"],
        },
      ],
    },
    {
      id: "scan_reaction",
      text: "Луч сканера крадётся по чужому корпусу. Секунда тишины растягивается в вечность — как они это прочтут?..",
      transitions: [
        {
          id: "scan_curious",
          label: "...",
          toLocation: "scan_intel",
          condition: "roll >= 5",
          effects: ["credits += 800"],
          autoExecute: true,
        },
        {
          id: "scan_alarmed",
          label: "...",
          toLocation: "standoff",
          effects: ["trust -= 4"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "scan_intel",
      text: "Чужак не вздрагивает — он будто позволяет себя читать, с чем-то, похожим на любопытство. А ваши сенсоры тем временем пьют золото: геометрия корпуса, сигнатуры двигателей, спектры сплавов, которых нет ни в одном каталоге. Такие логи любая ксенолаборатория оторвёт с руками. Дипломатического преимущества скан вам не дал — но трюм данных теперь стоит целое состояние.",
      transitions: [
        {
          id: "intel_to_greeting",
          label: "...",
          toLocation: "greeting",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "standoff",
      text: "Два корабля застыли друг против друга, разделённые лишь холодной пустотой и наведёнными стволами. Гул чужака стал ниже, настойчивее — предупреждение, не понять которое невозможно. Ваш офицер у орудий не сводит глаз с прицела; его палец в миллиметре от залпа. Одно резкое движение любой из сторон — и первый контакт станет первой войной.\nДоверие: {trust}",
      transitions: [
        {
          id: "stand_down",
          label:
            "Первым опустить орудия — рискнуть и показать мирные намерения",
          toLocation: "exchange_standdown",
          effects: ["trust += 4"],
        },
        {
          id: "hold_aim",
          label: "Не дрогнуть, держать прицел и требовать, чтобы отошли они",
          toLocation: "hostility_gate",
          effects: ["trust -= 2"],
        },
        {
          id: "fire_warning",
          label:
            "Дать предупредительный залп им под нос — черта, за которой война",
          toLocation: "hostility_gate",
          effects: ["trust -= 6"],
        },
      ],
    },
    {
      id: "exchange_gift",
      text: "Ваш дар уходит к ним по той же бесшумной дуге, что принёс их собственный, — и что-то в чужом гуле теплеет. Обмен идёт щедро, в обе стороны без счёта: символ за символ, образ за образ. Между двумя разумами, которым нечего было делить, растёт не сделка, а первое хрупкое доверие...",
      transitions: [
        {
          id: "resolve_peace",
          label: "...",
          toLocation: "resolution_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "exchange_take",
      text: "Вы забираете артефакт и молчите — ничего не предложив взамен. Чужой гул на миг сбивается, будто удивлённый; они всё равно продолжают говорить, но осторожнее, скупее. Обмен выходит односторонним: вы берёте, они дают, и между строк повисает вопрос, на который вы не ответили...",
      transitions: [
        {
          id: "resolve_peace",
          label: "...",
          toLocation: "resolution_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "exchange_demand",
      text: "Вы отвечаете на дар требованием — жёстко, с позиции силы, как привыкли говорить с теми, кто слабее. Чужой гул твердеет до металла. Они делятся данными, но цедят их по капле, будто выкуп, и каждый символ теперь пахнет не доверием, а расчётом. Вы получите обмен — но не дружбу...",
      transitions: [
        {
          id: "resolve_peace",
          label: "...",
          toLocation: "resolution_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "exchange_standdown",
      text: "Стволы уходят вниз — сначала ваши, потом, после долгой паузы, их. Обмен начинается на дрожащих руках, под привкус только что миновавшей войны: оба разума ещё помнят, как палец лежал на залпе. Понимание приходит медленно и с оглядкой, но приходит — вопреки тому, с чего всё началось...",
      transitions: [
        {
          id: "resolve_peace",
          label: "...",
          toLocation: "resolution_gate",
          effects: [],
          autoExecute: true,
        },
      ],
    },
    {
      id: "resolution_gate",
      text: "Чужой гул стихает до шёпота — они взвешивают всё, что вы им показали. Голограмма гаснет и вспыхивает вновь, складываясь в вердикт...",
      transitions: [
        {
          id: "to_alliance",
          label: "...",
          toLocation: "ending_alliance",
          condition: "trust >= 6",
          effects: ["credits += 3000", "rating += 30"],
          autoExecute: true,
        },
        {
          id: "to_trade",
          label: "...",
          toLocation: "ending_trade_pact",
          condition: "trust >= 2",
          effects: ["credits += 1500", "rating += 15"],
          autoExecute: true,
        },
        {
          id: "to_wary",
          label: "...",
          toLocation: "ending_wary_peace",
          effects: ["rating += 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "hostility_gate",
      text: "Гул срывается в резкий, режущий тон. Вдоль чужого корпуса раскрываются орудийные порты — медленно, неотвратимо, как приговор...",
      transitions: [
        {
          id: "to_war",
          label: "...",
          toLocation: "ending_war",
          condition: "trust <= -6",
          effects: ["rating -= 30"],
          autoExecute: true,
        },
        {
          id: "to_cold",
          label: "...",
          toLocation: "ending_cold_standoff",
          effects: ["rating -= 5"],
          autoExecute: true,
        },
      ],
    },
    {
      id: "ending_alliance",
      text: "Голограмма вспыхивает двумя ладонями, сомкнутыми в замок. Чужаки признали в вас ровню — и союзника. На прощание они переливают в ваши архивы фрагменты своих звёздных карт и оставляют в трюме горсть артефактов; позже, разобранные и оценённые в ближайшем порту, эти дары обратятся в целое состояние — оно уже звенит на вашем счету. Вы не просто избежали войны: вы открыли галактике нового друга. С этого мгновения человечество больше не одиноко.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_trade_pact",
      text: "Полного доверия не вышло, но хватило на большее, чем перемирие. Чужаки передают вам координаты точки встречи и простой протокол обмена — торговый пакт, скреплённый осторожным уважением. Не братство, но крепкое начало: два разума решили, что выгоднее меняться, чем стрелять.\nКредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_wary_peace",
      text: "Чужаки медленно разворачиваются и уходят — без залпов, но и без единого тёплого тона на прощание. Доверия вы не заслужили, лишь настороженное признание того, что стрелять не стоит. Войны нет, и уже за это стоит благодарить судьбу. Но дверь, что могла распахнуться настежь, осталась едва приоткрытой.\nРепутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_cold_standoff",
      text: "Гул обрывается на резкой, оборванной ноте. Чужой корабль пятится в тень газового гиганта, не опуская орудий, и растворяется во тьме так же внезапно, как явился. Первый контакт сорван: вы не дали им повода стрелять — но и повода доверять тоже. Где-то там теперь есть разум, который запомнил человечество как угрозу.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_war",
      text: "Пространство между кораблями вспарывает шквал чужого огня. Щиты воют, палубы содрогаются, аварийные сирены заглушают всё — вы отвечаете залпом на залп, потому что выбора уже нет. Первая встреча двух разумов обернулась первой войной, и её эхо будет катиться по звёздам ещё долго после того, как остынут обломки. Историю напишут не с тех слов, на которые вы надеялись.\nРепутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
