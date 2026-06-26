// Russian (default) UI dictionary. RU values are the verbatim in-game strings.
//
// Keys are namespaced `area.thing` (e.g. `common.back`, `settings.title`). Keep
// this in lockstep with `en.ts` — the parity test (`src/tests/i18n/parity.test.ts`)
// fails if the two key sets diverge. Add a new string here AND in `en.ts`.

import type { Dict } from "./i18n";

export const ru: Dict = {
  // --- common controls -----------------------------------------------------
  "common.back": "Назад",
  "common.close": "Закрыть",
  "common.cancel": "Отмена",
  "common.confirm": "Подтвердить",
  "common.ok": "ОК",
  "common.yes": "Да",
  "common.no": "Нет",
  "common.buy": "Купить",
  "common.sell": "Продать",
  "common.credits": "кредитов",
  "common.continue": "Продолжить",

  // --- settings panel ------------------------------------------------------
  "settings.title": "НАСТРОЙКИ",
  "settings.speed": "СКОРОСТЬ",
  "settings.font": "ШРИФТ",
  "settings.neural": "НЕЙРОСЕТЬ",
  "settings.language": "ЯЗЫК",
  "settings.on": "ВКЛ",
  "settings.off": "ВЫКЛ",
};
