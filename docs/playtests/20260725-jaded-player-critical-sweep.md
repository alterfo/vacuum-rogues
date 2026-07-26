# Jaded-Player Critical Sweep — 2026-07-25

Method: 27-agent critical review (20 quest scripts in `src/systems/quests/scripts/` + 7 planet/station hub scenes), each briefed as "the most jaded veteran player of the original Космические рейнджеры," graded against `docs/requirements/reference/SOURCE-OF-TRUTH.md`. 169 raw findings, deduplicated into patterns below. Followed by a synthesis pass and a structural verdict (xhigh effort).

Trigger: user felt the game is "cosmetically annoying in a thousand small ways" and "doesn't reach Space Rangers' level," and had no practical way to enumerate it all by hand.

---

## Verdict

Это не «полировка vs дизайн» — это оба, но в разной пропорции, и раздел 3 бэклога (A–I) сам себя маскирует под «контентные придирки», хотя на деле указывает на структурную дыру.

**Главный диагноз**: канон (§8 SOURCE-OF-TRUTH) называл ключевым отличием игры генеративный ONNX-нарратор — «ситуации и реплики генерируются, а не выбираются из фиксированных вариантов». Этот слой убран (CLAUDE.md: «onnxruntime-web removed»), и 20 квестов остались статичными деревьями выборов. Отсюда и весь раздел 3: доминантные безрисковые ветки (A), концовки слепые к пути (B), фиктивные награды (C), немые броски (D) — это не 20 разных авторских недоработок, а один системный симптом: **дерево без вариативности решается один раз и умирает навсегда**. В оригинале Rangers каждый текстовый квест — это пул вариантов текста + скрытая удача + рандомизированные пороги, поэтому один и тот же квест-скрипт ощущается по-разному при третьем прохождении. Здесь — нет.

При этом «живая галактика» (NpcSimulator, гарнизонный слой, Overmind arc с адаптивным campaignPeakPower) уже построена и весьма сложна — это НЕ дыра. Дыра в том, что она **не долетает до экрана игрока**: PlanetInfoPanel не показывает population/economy/politicalSystem/attitude, хотя эти поля уже в домене и уже используются таможней (§11.1 явно требует их показывать); робот-ассистент из §11.4 («System check: Ship ready for launch») просто отсутствует в HangarPanel/StationScene. Игра симулирует живой мир, но хаб выглядит как немой киоск с тостами — там, где должна быть личность.

### Топ-рычаги (impact/effort)

1. **Вариативный слой поверх QuestScript** (высокий impact, средний effort). Не переписывать 20 файлов вручную — ввести конвенцию в схему: каждая развилка — пул из 3–5 текстов по истории пути + скрытый бросок + рандомизация числовых порогов/наград в диапазоне от seed. Это закрывает разделы 3A/B/D/F одним архитектурным изменением, а не двадцатью точечными правками, и это единственное, что реально возвращает реиграбельность взамен убранного ONNX.
2. **Дотащить уже существующие данные до хаба** (высокий impact, низкий effort). PlanetInfoPanel: население/экономика/политстрой/отношение — данные уже есть, это чистая проводка UI, прямое нарушение §11.1. Плюс голос робота-ассистента при ремонте/дозаправке (§11.4) — эффект «мир вокруг реагирует» стоит дёшево, потому что бэкенд уже готов.
3. **Универсальный фидбек транзакций** (средний impact, низкий effort). Молчащие тосты в StationScene/EquipmentShopScene на самых частых циклах (покупка снаряжения/корпуса/микромодуля) убивают ощущение, что твои действия имеют вес — это прямая противоположность «живому миру».
4. **Тест-конвенция «текст соответствует эффекту + концовка учитывает путь»** как lint/regression, а не разовая правка — иначе раздел 3C/E вернётся с 21-м квестом.
5. Overmind-пейсинг (LOSS-dominant, day ~428) — реальная системная проблема, но уже под отдельным трекингом; не она объясняет «скучные квесты» из этого сэмпла.

---

## Триаж-бэклог

### 1. Быстрые косметические правки (низкие усилия, высокое раздражение)

- **Опечатка «Дог» вместо «Док»** в параметрах доков, видна на каждом экране квеста — `src/systems/quests/scripts/cargo-sort.ts:81,88,96` — **S**
- **`sellHoldItem()` проигрывает звук покупки при продаже** — есть готовый `SfxKey "sell"`, но используется `"buy"` — `src/presentation/EquipmentShopScene.ts:1166` — **S**
- **`buyHull()` вообще не проигрывает звук** покупки, хотя это самая крупная транзакция в игре — `src/presentation/EquipmentShopScene.ts:596-630` — **S**
- **Лучшая концовка трибунала: кредиты растут (+500), а текст говорит «вы платите штраф, стиснув зубы»** — знак спутан, во всех остальных квестах `credits -=` для этого паттерна — `src/systems/quests/scripts/tribunal.ts:206-213,230-234` — **S**
- **Необработанная английская метка «Transfer» в русском логе шины банка** — единственный непереведённый тип команды из шести — `src/presentation/bankSceneView.ts:144` — **S**
- **Цвета тостов в банке противоречат друг другу**: «отказ в кредите» и «кредит выдан» — один и тот же золотой цвет; «нет кредита для погашения» — тот же циан, что и «успешное снятие» у другого действия — `src/presentation/BankScene.ts:646,660-663,674,681,700-703` — **S**
- **«Влобовой» — не слово**, нужно «Лобовой» / «В лобовую» — `src/systems/quests/scripts/signal-decode.ts:85-86` — **S**
- **«коротая» вместо «короткая»** в самой первой строке квеста — `src/systems/quests/scripts/signal-decode.ts:74` — **S**
- **«Качает головой» (жест неодобрения) в одном предложении с прямой похвалой** — тональный разнобой в финальной реплике — `src/systems/quests/scripts/gravity-slalom.ts:284` — **S**
- **Заглушки-плейсхолдеры `label: "..."`** буквально попадают в данные (мертвый код, но риск регрессии при смене рендера) — `src/systems/quests/scripts/reactor.ts:145,152,165,172,186,193,207,214`, аналогично `derelict-salvage.ts:140,148` — **S**
- **Неверный fallback фракции**: пустой `ownerFaction` рисуется как «Окраинники» вместо принятого в проекте «Независимая» (`factionDisplayLabel`) — `src/presentation/PlanetInfoPanel.ts:60-63` — **S**
- **Сообщение об отказе взлёта всегда винит «нет двигателя»**, даже если реально не хватает топливного бака — дублируется в двух сценах — `src/presentation/StationScene.ts:856-868`, `src/presentation/PlanetScene.ts:1912-1913` — **S**
- **Несогласованный формат валюты в одной сцене**: с пробелом перед ₡ в шапке, без пробела в строках цен — `src/presentation/EquipmentShopScene.ts:320-321` vs `531-545,836-837,1042` — **S**
- **Ярлыки выборов печатают точные числовые дельты (+3 к защите, +1 к позиции…)**, превращая диалог в таблицу — стилевой выброс на фоне всех остальных скриптов — `src/systems/quests/scripts/boarding-standoff.ts:81,88,94,107,121`, `tribunal.ts:79-97,106-124,153-167` — **S/M**
- **Бармен/погранзастава/фрахтовщик — комментарий в шапке файла говорит «freighter», весь текст — «станция»**, локация без имени — `src/systems/quests/scripts/reactor.ts:3` vs `63,225,231` — **S**

### 2. UX-трение в хабах (по сценам)

#### StationScene.ts
- **Тосты покупок/апгрейдов молча проглатываются во вкладках Магазин, Микромодули, Исследования** — `addToastSlot()` вызывается только из `renderMain()`/`HangarPanel`, `this.toast` остаётся `null` в остальных вьюхах, `showToast()` — тихий no-op. Покупка микромодуля вообще не даёт игроку никакого фидбека — `renderShop() 885-1080`, `renderMicromoduleShop() 1107-1328`, `renderResearch() 1359-1375` — **M** (HIGH)
- **Фон хаба — сплошной чёрный прямоугольник**, никакого арта станции, в отличие от полной панорамы у PlanetScene — `renderMain() 327-336` vs `PlanetScene.ts createUI() 977-1030` — **L**
- **Кнопки сервисов — сырой текст в скобках вместо общего компонента `UiButton`** (нет иконок, акцентных полос, hover/press-состояний, которые есть у PlanetScene) — `renderMain() 434-464` vs `PlanetScene.ts 1288-1334` — **M**
- **Вражеская блокировка не даёт подсказки по восстановлению отношений** (у PlanetScene есть `standingRecoveryHint`, тут — нет) — `renderMain() 421-490` vs `PlanetScene.ts 1350-1381` — **S**
- **Верстка кнопок — фиксированный шаг в пикселях**, может вылезти за границы панели на низком экране с 7-8 сервисами — `renderMain() 428-464` vs адаптивный `computePlanetMenuLayout` у PlanetScene — **S/M**
- **Нет реплики робота-ассистента при ремонте/дозаправке**, хотя это прописано в SOURCE-OF-TRUTH §11.4 — `doRepair() 741-766`, `doRefuel() 768-793` — **M**

#### PlanetScene.ts / PlanetInfoPanel.ts / PlanetSprite.ts
- **На планетах нет дозаправки** — «Верфь» рисует топливный индикатор, но чинит только корпус; StationScene дозаправку умеет, планета — нет — `openGarage() 1637-1680` — **M** (HIGH)
- **Баннер «ЗАХВАЧЕНА» — мёртвый код**: читает `planet.capturedBy`, который никогда не пишется в проде (по собственному комментарию файла); нужно использовать системную проверку `isPirateSystem`/`isHostileSystem` — `PlanetScene.ts 1087-1109` vs `1365-1367` — **S** (HIGH)
- **Инфопанель не показывает население/тип экономики/политсистему/отношение**, хотя эти поля уже есть в домене и напрямую используются игрой (таможня проверяет politicalSystem) — `PlanetInfoPanel.ts 52-72`, `addInfoPanel() PlanetScene.ts 1396-1497` — **M** (HIGH)
- **Кнопка «Приземлиться» всегда яркая и кликабельная, даже когда посадка запрещена** — `landingDenial()` считается для тултипа при наведении, но не перепроверяется при клике; попытка сжигает игровой день — `PlanetInfoPanel.ts 82-99` + `PlanetManager.ts 509-566` + `SpaceFlightScene.ts 937-946` — **M** (HIGH)
- **Заблокированные (враждебная фракция) кнопки сервисов — `eventMode: "none"`**, вообще без наведения/клика/объяснения — `PlanetScene.ts makeServiceBtn 1293-1319`, тот же паттерн в `PlanetInfoPanel.ts land 100-105` — **S**
- **Модальные окна (таможня, покупка карты) — самописные кнопки на Graphics** вместо общего `UiButton`, визуально выбиваются — `PlanetScene.ts 734-784, 1792-1854` — **M**
- **Нигде нет голоса NPC/робота** — все реплики хаба чисто механические тосты («Штраф уплачен: −1200 ₡»), нет тона «System check…» из SOURCE-OF-TRUTH §11.4 — `PlanetScene.ts 1652,1676-1679,863-910,1953-1987` — **M**
- **Кнопка «Исследования» — вечная заглушка** без условия видимости (в отличие от скрытия меню для необитаемых планет) — `PlanetScene.ts 1253-1258, 1706-1710` — **S**
- **Тосты появляются/исчезают без анимации**, нет визуального различия награда/штраф кроме цвета текста — `showMessage() 1953-1987` — **M**
- **`PlanetInfoPanel` не мигрирован на `scaledText`** — игнорирует настройку масштаба шрифта S/M/L — весь файл — **S**
- **Название планеты без `wordWrap`** — может вылезти за фиксированную панель 220px — `PlanetInfoPanel.ts 32-50` — **S**
- **Клик по планете не даёт собственного фидбека** отдельно от hover-свечения (актуально для touch/быстрого клика) — `PlanetSprite.ts 606-611` — **S**

#### EquipmentShopScene.ts
- **Тосты покупки/продажи не подключены на вкладках СНАРЯЖЕНИЕ и КОРПУС** — самый частый цикл взаимодействия в хабе идёт без единого подтверждения — `render()` gear/hull branch, `addToastSlot` вызывается только из `renderHangar()` — **M** (HIGH)
- **Оружие никогда не получает сравнение характеристик «→ заменяет X»**, которое есть у остального снаряжения — `installedOfSameClass() 674-694` — **S/M**
- **Полосы ТРЮМ/УСТАНОВЛЕНО молча обрезают лишние предметы**, нет индикатора «+N ещё» — `renderLoadoutStrip() 973`, `renderHold() 1063` — **S**
- **Ноль реплик продавца/личности сцены** — все строки чисто механические — **M**

#### BankScene.ts / bankSceneView.ts
- **Панель «ШИНА: команды → проводки» — сырой инженерный дебаг-вид на половину экрана**, по признанию собственного комментария кода это «учебный артефакт для демо» — `BankScene.ts 80-81, 436-465` — **L** (HIGH; решение — либо спрятать за `__DEBUG__`, либо переодеть в реплики банковского клерка)
- **Фиксированный шаг 1000₡ на все операции без ввода суммы/«максимум»** — превращает крупный вклад в десятки кликов — `lines 56-60, 260-281` — **M**
- **Кнопки действий никогда не гаснут для заведомо невалидных операций** (нет вклада — кнопка «снять» всё равно яркая) — `260-285, 529-575` — **S/M**
- **`showToast` не использует общий `scaledText`**, единственный текст сцены, игнорирующий accessibility-масштаб — `725-751` — **S**
- **Заголовочная строка кредитов дублирует первую строку панели счетов** чуть ниже — впустую потрачено место, где могла бы быть личность банка — **S**

#### HangarPanel.ts (общий, StationScene + EquipmentShopScene)
- **Нет реплики робота-ассистента при диагностике корпуса**, хотя явно прописано в каноне (§11.4) — `renderServiceCenter 1728-1807` — **M** (HIGH)
- **Ни одного звукового эффекта во всём файле** (ремонт, продажа, установка, джеттисон, пресеты) — **M** (HIGH)
- **Hover-подсветка подключена только у 2 из ~15 кликабельных элементов** — остальные выглядят «мёртвыми» до момента клика — **S/M**
- **Заглушка арта корпуса — плоский синий квадрат**, если текстура не резолвится, а это визуальный центр всего экрана — `renderHullArtBox 925-936` — **M**
- **Полоса статов (МАССА/СВОБОДНО/СКОРОСТЬ/ЗАЩИТА) — голые числа без дельт** при наведении на предмет к установке — `renderHangarStats 640-684` — **M**

### 3. Системные проблемы контента квестов (повторяющиеся паттерны — самое важное)

Это не единичные придирки — один и тот же набор дефектов встречается в подавляющем большинстве из 20 скриптов. Именно это создаёт ощущение «плоско/скучно», а не отдельные баги.

**A. Доминирующий/безрисковый выбор устраняет всю заявленную дилемму** (самый частый паттерн — почти в каждом квесте с ветвлением есть решённая арифметика, а не решение):
`auction.ts` (skip_lot), `boarding-standoff.ts` (stall_talk+offer_cargo), `hostage-rescue.ts` (snipe_first — гарантированно убирает риск; pay_ransom — заведомая ловушка), `first-contact.ts` (scan строго хуже broadcast), `life-support.ts` (лучшая концовка требует 50/50, но путь к ней детерминирован до самого броска), `orbital-escape.ts` (trim_burn всегда доступен, остальные опции — декорация), `plague-crisis.ts` (fast_route строго доминирует над safe_route), `smuggling-run.ts` (bluff бесплатен при низком heat), `tribunal.ts` (максимально агрессивный путь одновременно и безопасный, и оптимальный), `gravity-slalom.ts` (design-комментарий врёт про «зависимость от seed» — маршрут фиксирован).
→ Требует ребаланса стоимостей/рисков в каждом скрипте отдельно, но это один системный чек-лист. **L** (по всему каталогу; каждый файл в отдельности — S/M)

**B. Концовки/переходы слепы к пройденному пути — один и тот же текст для разных решений**:
`auction.ts` (текст-«раскрытие» после уже показанной цены), `boarding-standoff.ts` (сцена resolve одинакова при любом исходе), `derelict-salvage.ts` (способ абордажа нигде не упоминается в 4 концовках), `evacuation.ts` (second_run идентичен для всех доков), `first-contact.ts` (одна и та же сцена «exchange» для щедрости, вымогательства и капитуляции), `investigation.ts` (улики никогда не ветвятся на реального убийцу — дедукция декоративна), `quarantine.ts` (самый мрачный выбор — «продувка в космос» — не получает своей концовки), `signal-decode.ts` (концовки не различают метод расшифровки), `smuggling-run.ts` (единый текст успеха для всех трёх уровней выплаты), `customs.ts` (next_ship идентичен независимо от исхода), `cargo-sort.ts` (один текст успеха/провала на весь диапазон исходов), `life-support.ts` (tally_few схлопывает диапазон saved 2-5 в одну реплику).
→ Системное нарушение собственного стандарта README скриптов («endings that acknowledge the path taken»). **L**

**C. Текст обещает награду/последствие, которого механика не даёт**:
`auction.ts` («барыш» — чисто фиктивное число, реальная награда фиксирована на борде квестов), `customs.ts` (та же дыра — цель в 5000₡ никак не влияет на реальную выплату), `first-contact.ts` (ending_alliance обещает звёздные карты и трофеи — ничего не выдаётся), `boarding-standoff.ts` («щедрая премия» при фактически отрицательном балансе кредитов), `derelict-salvage.ts` (катастрофическая концовка обходится без штрафа в кредитах).
→ **M/L**, точечные правки в reward-эффектах или в тексте.

**D. Единственный по-настоящему рандомный момент квеста получает ноль нарративной отдачи** (автопереход с `label: "..."`, silent roll):
`evacuation.ts` (route_check), `plague-crisis.ts` (fast_check — «точный манёвр» без единого игрового действия), `quarantine.ts` (help_check), `signal-decode.ts` (overclock_check), `sabotage-heist.ts` (hack_check), `orbital-escape.ts` (dump_check), `life-support.ts` (scrubber_check — единственная развилка риска во всём квесте), `locked-room.ts` (press_check и verdict_gate — два ключевых драматических момента). Игрок узнаёт исход только по изменившемуся числу на следующем экране.
→ Дать каждой ветке (успех/провал броска) собственную строку текста. **L** по каталогу, S на файл.

**E. Скрытые пороги мгновенного провала противоречат обещанному запасу прочности**:
`customs.ts` (текст обещает «ещё пара таких досмотров», реально — первая же ошибка мгновенно завершает квест), `investigation.ts` (порог репутации математически не даёт завершить корректную дедукцию методом исключения даже при идеальной игре), `quarantine.ts` (критические пороги паники/сдерживания нигде не раскрываются, «хорошие» комбо выборов ведут к скрытому провалу).
→ **M**, конкретный пересчёт чисел/текста в трёх файлах.

**F. Один и тот же микро-цикл зациклен N раз со сменой только цифр/декораций**:
`auction.ts` (8 лотов = один и тот же 3-выборный экран), `customs.ts` (20 кораблей = один шаблон), `cargo-sort.ts` (3 дока-клона), `reactor.ts` (8 идентичных кнопок ±1 стержня), `smuggling-run.ts` (3 идентичных чекпоинта).
→ Добавить хотя бы 1-2 варианта текста/твист на цикл. **M** на файл.

**G. Ярлыки печатают точные числа, убивая интерпретационный риск** — см. раздел 1 (`boarding-standoff.ts`, `tribunal.ts`) плюс частично `life-support.ts` (fix_scrubber label скрывает реальный штраф провала). **S/M**.

**H. Ноль личности/юмора у NPC на значительной части текста**:
`cargo-sort.ts` (бригадир без имени), `customs.ts` (20 идентичных кораблей без капитанов), `gravity-slalom.ts` (учёный молчит всю середину квеста), `orbital-escape.ts` (единственная реплика на весь квест), `hostage-rescue.ts` (антагонист пропадает после одной фразы), `sabotage-heist.ts` (напарник без имени, одна реплика перед броском на предательство), `signal-decode.ts` (сухой технобабл при премисе «люди могут умереть»), `locked-room.ts` (подозреваемые — по одному прилагательному на каждого).
→ **M** на файл, требует авторского прохода, не логики.

**I. Мёртвые флаги/выборы, которые ни на что не влияют**:
`derelict-salvage.ts` (`sealed` параметр выставляется и никогда не читается — «безопасный» выбор строго хуже жадного), `sabotage-heist.ts` (`slip_out` с напарником в команде — тот же исход, что и без напарника, 500₡ потрачены впустую), `cargo-sort.ts` (design-комментарий описывает механику типов груза, которой нет в коде вообще).
→ **S/M** на файл.

### 4. Всё остальное

- **Головоломка cargo-sort почти невозможно проиграть** — даже самая тупая жадная эвристика проходит почти все сиды; порог требует ужесточения бюджета времени/вместимости — `src/systems/quests/scripts/cargo-sort.ts` — **M**
- **Ложная реклама seed-зависимости в gravity-slalom** — комментарий утверждает вариативность, маршрут на деле фиксирован и раскрывается на первом же экране — `gravity-slalom.ts:8,74,189-220` — **M**
- **Почти половина локаций gravity-slalom — однокнопочные «нажми продолжить» экраны**, выдаваемые за выбор — `cell_a3/b3/c1/c2` — **S**
- **Собственное признание свидетеля (охранник) противоречит «драматическому раскрытию» улики №3**, и игрок не может это использовать в допросе — `investigation.ts:283` vs `320-330` — **M**
- **Reactor.ts форсирует до 3.2 сек некликабельного ожидания на каждый ход** — таймер давления соревнуется с самим собой, а не усиливает его — `reactor.ts:140-222` — **M**
- **Второй квест-клон про эпидемию/карантин в каталоге из 20** (`plague-crisis.ts` и `quarantine.ts` — идентичная премиса «держи метр выше нуля, максимизируй спасённых, выбери степень жестокости») — сама README уже защитно это признаёт; на будущее не добавлять третий такой шаблон — **L** (design note, не баг)
- **`GearBridge.gearMicromoduleCategory` даёт вводящий в заблуждение лейбл «[нет микромодулей]»** для снаряжения, которое структурно никогда не может принять микромодуль (сейчас мёртвый код, но ловушка при добавлении нового `GearKind`) — `HangarPanel.ts` `renderFilledSlot` — **S**
- **Ретроспективная заметка**: файл `PlanetSprite.ts`, изначально назначенный для ревью хаба, не содержит UI хаба вообще (только орбитальный визуал планеты) — фактический хаб живёт в `PlanetScene.ts`; будущие ревью «планетного хаба» стоит нацеливать именно туда — **не задача, орг. заметка**

---

Also caught in the auction.ts review but worth flagging separately: the `TextQuestScene` restart button reuses `this.vmSeed` (`TextQuestScene.ts:79,270`), so a failed run replays with full foreknowledge and can be beaten by brute-force retry with zero mechanical penalty. This is a `TextQuestScene` engine bug (not per-quest), likely affects all 20 scripts, not just auction — worth checking before starting on Lever #1.

---

## Follow-up: what the 2026-07-26 polish pass resolved

`docs/plans/20260726-quest-and-hub-polish-pass.md` (36 tasks) worked this backlog end to end. Status of the findings above:

**Structural lever #1 (variance) — resolved.** The Task-14 text-pool primitive (`QuestLocation.text: string | string[]`, resolved deterministically per `(seed, locationId)` without consuming the RNG stream) is the lower-cost partial substitute for the removed ONNX narrator. Applied across all 20 scripts (Tasks 15–34): branched per-path endings (pattern **B**), risk-priced or qualitatively-labelled choices (**A**/**G**), narrated rolls (**D**), captain/partner personality (**H**), and dead flags either wired into a real branch or removed (**I**). The `TextQuestScene` restart seed-reuse exploit (last section above) is fixed (Task 1 — fresh attempt-derived seed).

**Structural lever #2 (data-to-hub) — resolved.** `PlanetInfoPanel` now shows population/economy/politicalSystem/attitude (§11.1, Task 9); the robot-assistant service voice (§11.4) lands on repair/refuel/diagnostic (Task 10). Plus the swallowed-feedback loops: purchase/upgrade/service toasts (Tasks 7, 10), missing SFX (Tasks 4, 8), the misleading launch-denial reason (Task 6), the still-clickable denied-landing button (Task 11), and the dead «ЗАХВАЧЕНА» banner path (Task 12). The user-spotted quest-text flash-by is fixed by the reduced-motion-gated typewriter reveal (Task 2).

**Deferred (test-locked — need explicit user go-ahead + a test update, not skipped work):**
- `tribunal.ts` credit-sign bug on the lenient/fine path — `batch2QuestScripts.test.ts:430` locks `credits === 500` (the buggy `+500`). (Task 3)
- `bankSceneView.ts` untranslated "Transfer" bus-log label — `bankSceneView.test.ts:195` locks the English string. (Task 5)
- `boarding-standoff.ts` `stall_talk`+`offer_cargo` dominant combo repricing — `batch1QuestScripts.test.ts:277-287` locks its exact `-1000/rating 120` outcome. (Task 16)
- `tribunal.ts` roll-free aggressive line repricing — `batch2QuestScripts.test.ts:410-420` locks the acquittal outcome; also depends on the deferred sign fix. An additive vindication tier (Task 34) resolves the same "safest ≠ richest" complaint without touching the locked assertion.

Each is a genuine known-good-test block (per the plan's Development Approach and the standing no-touch-existing-tests rule), documented here so a future pass can pick them up with the assertion update the user signs off on.
