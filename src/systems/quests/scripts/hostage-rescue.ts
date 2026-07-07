import type { QuestScript } from "../QuestScript";

// Design: Pirates hold 4 hostages on station «Терновник». Pick an approach:
//   - pay_ransom : pay 2000 cr, then trust the pirates (a roll decides honor)
//   - stealth    : sneak in (roll-based) or work methodically (slow but sure)
//   - assault    : storm the station; outcome scales with the guard count.
//                  Sniping first removes 2 guards, guaranteeing a clean assault.
// `guards` is randomised 2–4, so the raw assault outcome varies by seed.
// Outcomes (credits = bounty, rating = reputation, hostages = survivors):
//   - ending_ransom_good        all freed, money gone, small rep      SUCCESS
//   - ending_ransom_betrayed    pirates renege, hostages die          FAILURE
//   - ending_stealth_clean      all freed quietly, big bounty + rep   SUCCESS
//   - ending_stealth_partial    spotted, grabbed 2, modest reward     SUCCESS
//   - ending_stealth_methodical all freed slowly, solid reward        SUCCESS
//   - ending_assault_clean      all freed, big bounty + rep           SUCCESS
//   - ending_assault_costly     2 lost, some bounty, rep hit          SUCCESS
//   - ending_assault_fail       assault collapses, hostages die       FAILURE
export const hostageRescueScript: QuestScript = {
  id: "hostage-rescue",
  title: "Спасение заложников",
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
      id: "hostages",
      name: "Заложники",
      min: 0,
      max: 4,
      initial: 4,
      showInUI: true,
    },
    {
      id: "guards",
      name: "Охрана",
      min: 2,
      max: 4,
      initial: "random",
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
  startLocation: "briefing",
  locations: [
    {
      id: "briefing",
      text: "Станция «Терновник» захвачена. На панораме — четыре лица, прижатых к иллюминатору камеры: механик, две девушки-геологи, седой навигатор. По общему каналу хрипит главарь: «Четверо у меня, рейнджер. Тянуть будешь — начну по одному».\nЗаложники: {hostages} | Репутация: {rating}\n\nКаждая секунда — чья-то жизнь. Ваш план?",
      transitions: [
        {
          id: "pay_ransom",
          label: "Заплатить выкуп — 2000 кр и надежда на пиратскую честь",
          toLocation: "ransom_path",
          effects: ["credits -= 2000"],
        },
        {
          id: "stealth",
          label: "Тихо проникнуть на станцию, без единого выстрела",
          toLocation: "stealth_approach",
          effects: [],
        },
        {
          id: "assault",
          label: "Штурмовать — быстро, жёстко, в лоб",
          toLocation: "assault_prep",
          effects: [],
        },
      ],
    },
    // ── RANSOM ─────────────────────────────────────────────────────────────
    {
      id: "ransom_path",
      text: "Счёт уходит: 2000 кр перетекают на анонимный кошелёк пиратов. Главарь усмехается в эфир: «Разумный выбор, рейнджер. Ждём, пока звёзды сойдутся». Ваши деньги у них — но заложники по-прежнему за их шлюзом. Слово пирата не стоит и ломаного болта.",
      transitions: [
        {
          id: "trust",
          label: "Держать дистанцию и ждать — пусть выпускают людей",
          toLocation: "ransom_outcome",
          effects: ["roll = random(0,9)"],
        },
      ],
    },
    {
      id: "ransom_outcome",
      text: "Минуты тянутся вечностью. Наконец в стыковочном узле вспыхивают огни, и тяжёлый шлюз «Терновника» с лязгом ползёт в сторону...",
      transitions: [
        {
          id: "honored",
          label: "...",
          toLocation: "ending_ransom_good",
          condition: "roll >= 4",
          effects: ["rating += 10"],
          autoExecute: true,
        },
        {
          id: "betrayed",
          label: "...",
          toLocation: "ending_ransom_betrayed",
          effects: ["hostages -= 4"],
          autoExecute: true,
        },
      ],
    },
    // ── STEALTH ────────────────────────────────────────────────────────────
    {
      id: "stealth_approach",
      text: "Скафандр гасит шум шагов. Через грузовой шлюз вы просачиваетесь в брюхо станции. Впереди — залитый красным дежурным светом пост охраны, а за ним прямой коридор к камерам, где ждут четверо. Один часовой дремлет над пультом; второй мерит переборку неспешными шагами.",
      transitions: [
        {
          id: "sneak",
          label:
            "Проскользнуть мимо часовых одним броском — быстро, но на грани",
          toLocation: "stealth_check",
          effects: ["roll = random(0,9)"],
        },
        {
          id: "methodical",
          label:
            "Работать методично: заглушить камеры, снимать посты, выводить людей по одному",
          toLocation: "ending_stealth_methodical",
          effects: ["credits += 1500", "rating += 20"],
        },
      ],
    },
    {
      id: "stealth_check",
      text: "Затаив дыхание, вы скользите вдоль переборки в полуметре за спиной часового. Его пальцы лежат на предохранителе, взгляд скользит по коридору. Один скрип подошвы — и всё рухнет...",
      transitions: [
        {
          id: "sneak_clean",
          label: "...",
          toLocation: "ending_stealth_clean",
          condition: "roll >= 3",
          effects: ["rating += 30", "credits += 3000"],
          autoExecute: true,
        },
        {
          id: "sneak_spotted",
          label: "...",
          toLocation: "ending_stealth_partial",
          effects: ["hostages -= 2", "credits += 1000", "rating += 5"],
          autoExecute: true,
        },
      ],
    },
    // ── ASSAULT ────────────────────────────────────────────────────────────
    {
      id: "assault_prep",
      text: "Сканер термооптики размечает станцию красными метками: часовых на борту — {guards}, каждый при тяжёлом стволе, и все между вами и заложниками. Чем больше стволов, тем выше шанс, что в горячке боя пуля достанется не пирату. Это будет кроваво.",
      transitions: [
        {
          id: "breach_loud",
          label: "Вышибить шлюз и идти на пролом — по всем сразу",
          toLocation: "assault_check",
          effects: [],
        },
        {
          id: "snipe_first",
          label: "Сперва снять двоих бесшумным снайпером и уравнять шансы",
          toLocation: "assault_snipe",
          effects: ["guards -= 2"],
        },
      ],
    },
    {
      id: "assault_snipe",
      text: "Два коротких хлопка гасителя — и две красные метки на сканере гаснут одна за другой, оседая в тёмных углах коридора. Оставшихся часовых: {guards}. Теперь силы почти равны.",
      transitions: [
        {
          id: "now_breach",
          label: "Пора — вперёд, на штурм",
          toLocation: "assault_check",
          effects: [],
        },
      ],
    },
    {
      id: "assault_check",
      text: "Заряд срывает шлюз с петель, и коридор взрывается вспышками выстрелов. Крики, дым, лязг брони — вы врываетесь внутрь, ведя огонь на ходу...",
      transitions: [
        {
          id: "asn_fail",
          label: "...",
          toLocation: "ending_assault_fail",
          condition: "guards >= 4",
          effects: ["hostages -= 4", "rating -= 30"],
          autoExecute: true,
        },
        {
          id: "asn_costly",
          label: "...",
          toLocation: "ending_assault_costly",
          condition: "guards >= 3",
          effects: ["hostages -= 2", "rating -= 10", "credits += 1500"],
          autoExecute: true,
        },
        {
          id: "asn_clean",
          label: "...",
          toLocation: "ending_assault_clean",
          effects: ["rating += 25", "credits += 3500"],
          autoExecute: true,
        },
      ],
    },
    // ── TERMINALS ──────────────────────────────────────────────────────────
    {
      id: "ending_ransom_good",
      text: "Из шлюза, щурясь на свет, выходят все четверо — целые, живые, ошалевшие от свободы. Пираты, как ни странно, сдержали слово и растворились в темноте с вашими деньгами. Кошелёк пуст, зато все заложники дома, и флот это оценил.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_ransom_betrayed",
      text: "Шлюз распахивается — и в тот же миг станцию сотрясает взрыв. Пираты забрали выкуп и подорвали отсек с камерами, заметая следы. Все четверо погибли. Вы остались без денег, без заложников и с горьким уроком: пирату верить нельзя.\nЗаложники: {hostages} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
    {
      id: "ending_stealth_clean",
      text: "Ни выстрела, ни сирены. Все четверо заложников выведены через грузовой шлюз прежде, чем пираты вообще поняли, что на борту чужой. Флот высоко ценит такую ювелирную работу — премия и почёт ваши.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_stealth_partial",
      text: "Скрипнула подошва — и станция взорвалась тревогой. В яростной перестрелке вы успели выхватить из камер лишь двоих и с боем отступить к шлюзу; остальных вытащить не вышло. Двое спасены, двое остались там. Награда скромная — под стать половинчатому исходу.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_stealth_methodical",
      text: "Камера за камерой, пост за постом — вы разбирали станцию по частям, терпеливо и без единого выстрела. Это заняло часы, но все четверо заложников вышли на волю целыми и невредимыми. Надёжная, честная работа.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_clean",
      text: "Штурм отгремел за считаные секунды: охрана полегла, не успев прикрыться заложниками. Вы распахиваете двери камер — все четверо целы, оглушённые, но живые. Флот платит по-крупному за такую дерзкую и чистую работу.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_costly",
      text: "Бой вышел затяжным и грязным. Вы пробились к камерам и подавили охрану, но в перекрёстном огне двое заложников не уцелели. Двоих вы всё же вывели живыми. Задание закрыто — только вот цена оказалась страшной.\nЗаложники: {hostages} | Кредиты: {credits} | Репутация: {rating}",
      isSuccess: true,
      transitions: [],
    },
    {
      id: "ending_assault_fail",
      text: "Стволов оказалось слишком много. Вас встретили плотной стеной огня ещё в коридоре, штурм захлебнулся, и, отходя, пираты расстреляли камеры. Все четверо погибли, а вы едва унесли ноги. Полный провал.\nЗаложники: {hostages} | Репутация: {rating}",
      isFailure: true,
      transitions: [],
    },
  ],
};
