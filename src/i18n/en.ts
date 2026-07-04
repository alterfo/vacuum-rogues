// English UI dictionary (additive translation of `ru.ts`).
//
// Keep in lockstep with `ru.ts` — identical key set (the parity test enforces
// this). EN is the translated counterpart of each RU value.

import type { Dict } from "./i18n";

export const en: Dict = {
  // --- common controls -----------------------------------------------------
  "common.back": "Back",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.ok": "OK",
  "common.yes": "Yes",
  "common.no": "No",
  "common.buy": "Buy",
  "common.sell": "Sell",
  "common.credits": "credits",
  "common.continue": "Continue",

  // --- settings panel ------------------------------------------------------
  "settings.title": "SETTINGS",
  "settings.speed": "SPEED",
  "settings.font": "FONT",
  "settings.neuralAi": "NEURAL NET (AI)",
  "settings.neuralOn": "Neural-net AI enabled (experimental)",
  "settings.neuralOff": "Neural-net AI disabled",
  "settings.experimental": "experimental",
  "settings.language": "LANGUAGE",
  "settings.on": "ON",
  "settings.off": "OFF",
  // Language autonyms — identical to `ru.ts` on purpose (each language's own name
  // is shown in its own script regardless of the active UI language).
  "lang.ru": "Русский",
  "lang.en": "English",

  // --- accessibility panel (palette / reduced-motion / key remap) ----------
  "a11y.title": "ACCESSIBILITY",
  "a11y.palette": "PALETTE",
  "a11y.reducedMotion": "REDUCED MOTION",
  "a11y.controls": "CONTROLS",
  "a11y.reset": "Reset keys",
  "a11y.pressKey": "press a key…",
  "a11y.keyTaken": "key in use",
  "palette.default": "Default",
  "palette.deuteranopia": "Deuteranopia",
  "palette.protanopia": "Protanopia",
  "palette.tritanopia": "Tritanopia",
  "action.cancel": "Cancel",
  "action.runTurn": "Run turn",
  "action.journal": "Journal",
  "action.inventory": "Inventory",

  // --- shared labels -------------------------------------------------------
  "label.creditsLine": "Credits: {n}",

  // --- resources (market goods) --------------------------------------------
  "resource.FUEL": "Fuel",
  "resource.METALS": "Metals",
  "resource.CRYSTALS": "Crystals",
  "resource.ORGANICS": "Organics",
  "resource.ARTIFACTS": "Artifacts",
  "resource.WEAPONS": "Weapons",
  "resource.MEDICINE": "Medicine",
  "resource.ELECTRONICS": "Electronics",
  "resource.LUXURY": "Luxury",
  "resource.DATA_CORES": "Data Cores",

  // --- trade-route rumors (Info Center "Trade Opportunities" band) ----------
  "rumor.panelHeader": "TRADE OPPORTUNITIES",
  "rumor.panelEmpty": "No active trade routes",
  "rumor.panelNoIntel": "No intel yet — scout new systems",
  "rumor.line": "Ship {resource} from {from} to {to}: {margin}",
  "rumor.margin": "margin ~{pct}%",
  "rumor.marginMasked": "margin ~?%",
  "rumor.expired":
    "Shipping {resource} from {from} to {to} no longer pays — the deal has ended.",

  // --- Info Center news feed -----------------------------------------------
  "news.type.NPC_QUEST_COMPLETE": "[RANGER]",
  "news.type.PIRATE_ATTACK": "[ATTACK]",
  "news.type.MARKET_SHIFT": "[MARKET]",
  "news.type.OVERMIND_EXPANSION": "[THREAT]",
  "news.type.PIRATE_SURGE": "[PIRATES]",
  "news.type.TRADE_BOOM": "[TRADE]",
  "news.type.PLAGUE": "[PLAGUE]",
  "news.type.DISCOVERY": "[DISCOVERY]",
  "news.type.SYSTEM_LIBERATED": "[LIBERATED]",
  "news.type.SYSTEM_CAPTURED": "[CAPTURED]",
  "news.type.LIBERATION_CAMPAIGN": "[CAMPAIGN]",
  "news.type.TRADE_OPPORTUNITY": "[ROUTE]",
  "news.fallbackDesc": "{label} in system {system}",
  "news.distCurrentSystem": "current system",
  "news.distHere": "here",
  "news.distJumps": "{n} jmp",
  "news.pirateAlert": '[ALERT] Pirates in system "{system}" ({dist})',
  "news.deltaDown": " ▼{pct}% vs here",
  "news.deltaUp": " ▲{pct}% vs here",
  "news.marketBest":
    '[MARKET] {resource}: best price "{system}" — {price} ₡{delta} ({dist})',
  "news.traders": '[TRAFFIC] Traders active in system "{system}"',
  "news.patrol": '[PATROL] Escort fleet detected in system "{system}"',
  "news.loreTag": "[NEWS] {text}",
  "news.lore1":
    "The Independents' Council debates a neutrality pact with the Bastion",
  "news.lore2": "The Progressors announce a new «Omega»-class line of ships",
  "news.lore3": "The Outlanders expand trade routes into the southern sector",
  "news.lore4": "The Syndicate denies attacks on transport convoys",
  "news.lore5": "The Bastion raised military production by 40%",
  "news.lore6": "Paradoxes detected near the forbidden zone R-17",
  "news.lore7": "Rangers report anomalous activity in the nebula",

  // --- factions (singular type) / alliances (plural) / NPC roles -----------
  "factionType.OUTLANDERS": "Outlander",
  "factionType.BASTIONS": "Bastion",
  "factionType.SYNDICATE": "Syndicate",
  "factionType.PARADOXES": "Paradox",
  "factionType.PROGRESSORS": "Progressor",
  "faction.OUTLANDERS": "Outlanders",
  "faction.BASTIONS": "Bastions",
  "faction.SYNDICATE": "Syndicate",
  "faction.PARADOXES": "Paradoxes",
  "faction.PROGRESSORS": "Progressors",
  "faction.INDEPENDENT": "Independents",
  "faction.OVERMIND": "Precursors",
  "role.RANGER": "Ranger",
  "role.TRADER": "Trader",
  "role.PIRATE": "Pirate",
  "role.PATROL": "Patrol",

  // --- main menu -----------------------------------------------------------
  "menu.title": "VACUUM ROGUES",
  "menu.intro":
    "The galaxy stands at a breaking point: the ancient Precursors have " +
    "awakened, and their Overmind is turning system after system into a " +
    "silent mechanical swarm. You are a vacuum rogue — a free pilot with no " +
    "flag and no oath, who lives by trade, contracts and a precise shot. " +
    "Weave between the factions, fill your hold and your reputation, decide " +
    "whom to help and whom to fleece — and perhaps your battered ship is the " +
    "one that decides whether inhabited space will hold.",
  "menu.newGame": "New Game",
  "menu.saves": "Saved Games",
  "menu.settings": "Settings",
  "menu.feedback": "Send Feedback",
  "menu.replayTutorial": "Replay Tutorial",
  "menu.tutorialReset": "Tutorial reset — hints will show again",
  "menu.engineUnavailable": "Error: game engine unavailable",
  "menu.loading": "Loading...",
  "menu.noSaves": "No saved games available",
  "menu.loadError": "Load failed. Start a new game.",

  // --- new-game / faction selection ----------------------------------------
  "race.title": "CHOOSE YOUR FACTION",
  "race.back": "[ Back ]",
  "race.start": "START GAME",
  "race.difficulty": "DIFFICULTY",
  "race.mode.GOD.title": "God",
  "race.mode.GOD.desc":
    "The ship never dies — at zero hull, weapons and hyperjump stall until repaired",
  "race.mode.NORMAL.title": "Normal",
  "race.mode.NORMAL.desc": "Standard difficulty",
  "race.mode.HARD.title": "Hard",
  "race.mode.HARD.desc": "More pirates and Overmind, larger garrisons",
  "race.faction.OUTLANDERS.title": "OUTLANDERS",
  "race.faction.OUTLANDERS.desc":
    "Frontier colonists with reliable ships and a trade bonus.",
  "race.faction.OUTLANDERS.bonus": "✦ Reliability: reduced repair cost",
  "race.faction.BASTIONS.title": "BASTIONS",
  "race.faction.BASTIONS.desc":
    "A militant empire with heavy ships and powerful weapons.",
  "race.faction.BASTIONS.bonus": "✦ Military: +20% weapon damage",
  "race.faction.SYNDICATE.title": "SYNDICATE",
  "race.faction.SYNDICATE.desc":
    "A shadowy smuggler organization with fast ships.",
  "race.faction.SYNDICATE.bonus": "✦ Smuggling: +30% profit from illegal goods",
  "race.faction.PARADOXES.title": "PARADOXES",
  "race.faction.PARADOXES.desc":
    "A mysterious race with unpredictable technology and unique modules.",
  "race.faction.PARADOXES.bonus": "✦ Unpredictability: random combat bonuses",
  "race.faction.PROGRESSORS.title": "PROGRESSORS",
  "race.faction.PROGRESSORS.desc":
    "A technologically advanced race of explorers with cutting-edge systems.",
  "race.faction.PROGRESSORS.bonus": "✦ Technology: +15% equipment efficiency",
  "race.stat.hull": "Hull: {value}",
  "race.stat.shields": "Shields: {value}",
  "race.stat.speed": "Speed: {value}",
  "race.stat.evasion": "Evasion: {value}",

  // --- trade / market ------------------------------------------------------
  "trade.title": "MARKET — {planet}",
  "trade.colResource": "Resource",
  "trade.colBuy": "Buy",
  "trade.colSell": "Sell",
  "trade.colHold": "In Hold",
  "trade.colQty": "Qty",
  "trade.leave": "Leave Market",
  "trade.escHint": "[Esc] — exit",
  "trade.maxBtn": "M",
  "trade.bought": "Bought",
  "trade.sold": "Sold",
  "trade.result": "{verb}: {qty}×{name} for {price} cr.",
  "trade.insufficientCredits": "Insufficient credits",
  "trade.nothingToSell": "Nothing to sell",
  "trade.cargoFull": "Not enough cargo space",
  "trade.failed": "Trade failed",

  // --- job board / quest types ---------------------------------------------
  "quest.type.DELIVERY": "Delivery",
  "quest.type.BOUNTY": "Bounty",
  "quest.type.ESCORT": "Escort",
  "quest.type.DIPLOMACY": "Diplomacy",
  "quest.type.EXPLORATION": "Recon",
  "quest.type.TEXT_ADVENTURE": "✦ Story",
  "quest.type.DEFENSE": "⚔ Defense",
  "journal.questCompleted": "✓ Quest #{questId} completed",
  "jobBoard.title": "JOB BOARD",
  "jobBoard.maxQuests": "Max quests: {max}/{max}",
  "jobBoard.activeQuests": "ACTIVE QUESTS",
  "jobBoard.availableQuests": "AVAILABLE QUESTS",
  "jobBoard.noQuests": "No quests available.",
  "jobBoard.noDeadline": "No deadline",
  "jobBoard.expired": "EXPIRED",
  "jobBoard.daysLeft": "⏱ {days}d",
  "jobBoard.scrollHint": "wheel / arrows",
  "jobBoard.accepted": "✓ Accepted",
  "jobBoard.accept": "Accept",
  "jobBoard.requireRank": "Rank {rank}+",
  "jobBoard.busy": "Busy",

  // --- comms / NPC contact panel -------------------------------------------
  "comms.option.trade": "Trade",
  "comms.option.hire": "Hire",
  "comms.option.ally": "Ally",
  "comms.option.attack": "Attack",
  "comms.option.pay-tribute": "Pay Tribute",
  "comms.option.flee": "Flee",
  "comms.hail": "Hail",
  "comms.scan": "Scan",
  "comms.factionLine": "Faction: {name}",
  "comms.allianceLine": "Alliance: {name}",
  "comms.roleLine": "Role: {name}",
  "comms.hullLine": "Hull: {cur} / {max}",
  "comms.shieldsLine": "Shields: {n}",
  "comms.damageLine": "Damage: {n}",
  "comms.speedLine": "Speed: {n}",
  "comms.outOfRange": "Target out of radar range",
  "comms.approach": "Approach",
  "comms.noData": "No data available",
  "comms.equipment": "Equipment:\n{items}",
  "comms.cargo": "Cargo: {cargo}",
  "comms.shielded": "Target is field-shielded —\nscan impossible",

  // --- captured-system landing denial (with recovery hint) -----------------
  "landing.denial.overmind":
    "System under Overmind control — landing impossible",
  "landing.denial.pirateRep":
    "Planet captured by pirates — reputation required. Pay pirates off to raise it",

  // --- customs fine + standing-recovery hint (Task 7: no rep dead-end) ------
  "customs.fineReason": "Customs fine",
  "standing.recovery.faction":
    "Tip: complete faction quests to raise your standing",
  "standing.recovery.pirate":
    "Tip: pay pirates off to raise standing and regain access",

  // --- player-driven liberation of a captured system -----------------------
  "flight.liberationHint":
    "System captured. Destroy every invader to liberate it",
  "flight.systemLiberated": "System {name} liberated!",

  // --- pirate shakedown tribute («Откупиться») ------------------------------
  "flight.tributeReason": "Tribute to pirate «{name}»",
  "flight.tributePaid": "Paid {amount} cr. — {name} backs off.",
  "flight.tributePaidRep":
    "Paid {amount} cr. — {name} backs off. Pirate standing rises.",

  // --- combat salvage (Task 5: killing a credit-carrying NPC pays out) ------
  "flight.salvageTrophy": "Salvage: +{amount} ₡",
  "flight.salvageReason": "Salvage from a destroyed ship",

  // --- floating loot pickup (Task 6: collect drops by proximity) ------------
  "flight.lootPickup": "Picked up: {item}",
  "flight.lootTractor": "Gravity tractor collected: {item}",
  "flight.lootArtifact": "artifact",
  "flight.lootModule": "module",

  // --- incoming-attacker warning (Task 5: threat indicator) -----------------
  "flight.incomingAttacker": "⚠ Incoming attacker: {name}!",

  // --- onboarding / contextual help (panel chrome) -------------------------
  "help.controlsHeader": "Controls:",
  "help.gotIt": "Got it",

  // --- onboarding: welcome / goal intro ------------------------------------
  "help.welcome.title": "Welcome, rogue!",
  "help.welcome.body1":
    "You are a free pilot in a living galaxy. Your goal — get rich and stop" +
    " the Overmind threat: trade, take contracts, explore systems and" +
    " reinforce your ship until you're ready to fight back.",
  "help.welcome.body2":
    "Start small: fly to the nearest planet, look around and take your first" +
    " contract. The «?» button at the top right opens a hint for the current" +
    " screen at any time.",

  // --- onboarding: faction selection / new game ----------------------------
  "help.RACE_SELECTION.title": "New Game",
  "help.RACE_SELECTION.body1":
    "Choose a faction and a difficulty mode before starting a new run. Your" +
    " faction sets your starting bonuses, ship stats and standing with" +
    " others.",
  "help.RACE_SELECTION.body2":
    "Difficulty (God / Normal / Hard) decides how punishing the galaxy is." +
    " Make your picks, then hit «Start Game».",
  "help.RACE_SELECTION.control1": "Click a card — pick a faction",
  "help.RACE_SELECTION.control2": "Difficulty, then «Start Game» — begin",

  // --- onboarding: space flight --------------------------------------------
  "help.SPACE_FLIGHT.title": "Space Flight",
  "help.SPACE_FLIGHT.body1":
    "You pilot your ship within a star system. Approach planets and stations" +
    " to land, and other ships to engage in combat or hail them.",
  "help.SPACE_FLIGHT.body2":
    "To move to a neighbouring system, open the star map and make a" +
    " hyperjump.",
  "help.SPACE_FLIGHT.control1": "LMB on a point — fly there",
  "help.SPACE_FLIGHT.control2":
    "LMB on an object — interact (land / grapple / combat)",
  "help.SPACE_FLIGHT.control3": "Star map — hyperjump between systems",

  // --- onboarding: star map ------------------------------------------------
  "help.STAR_MAP.title": "Star Map",
  "help.STAR_MAP.body1":
    "The galaxy map shows star systems and the links between them. Pick an" +
    " available system and make a hyperjump to travel there.",
  "help.STAR_MAP.body2":
    "A jump consumes fuel and advances game time — watch your supplies and" +
    " what's happening across the galaxy.",
  "help.STAR_MAP.control1": "LMB on a system — select target",
  "help.STAR_MAP.control2": "Jump — travel to the selected system",

  // --- onboarding: planet --------------------------------------------------
  "help.PLANET.title": "Planet",
  "help.PLANET.body1":
    "You are on a planet's surface. From here you can reach the local" +
    " establishments: the market, shipyard, government, bank and information" +
    " center.",
  "help.PLANET.body2":
    "Drop by the market for a good deal, the government for a contract, and" +
    " the shipyard to upgrade your ship. Take off to return to space.",
  "help.PLANET.control1": "Establishment buttons — enter",
  "help.PLANET.control2": "Take off — return to flight",

  // --- onboarding: trade ---------------------------------------------------
  "help.TRADE.title": "Trade",
  "help.TRADE.body1":
    "Buy low, sell high. Prices vary from planet to planet — carry goods to" +
    " where they're scarce and turn a profit.",
  "help.TRADE.body2":
    "Watch your cargo capacity and demand: rumors in the info center hint at" +
    " where each good fetches a high price.",
  "help.TRADE.control1": "Buy / Sell — close a deal",
  "help.TRADE.control2": "Quantity — set the amount",

  // --- onboarding: station -------------------------------------------------
  "help.STATION.title": "Space Station",
  "help.STATION.body1":
    "At a station you can refuel, repair, refit your ship in the hangar and" +
    " stock up on equipment.",
  "help.STATION.body2":
    "In the hangar, install weapons and modules by slot and watch the mass —" +
    " an overloaded ship won't take off.",
  "help.STATION.control1": "Hangar — outfit the ship",
  "help.STATION.control2": "Services — fuel / repair",

  // --- onboarding: shipyard / equipment ------------------------------------
  "help.EQUIPMENT_SHOP.title": "Shipyard & Equipment",
  "help.EQUIPMENT_SHOP.body1":
    "Three tabs here: «Gear» — weapons, engines and modules; «Hull» — new" +
    " hulls with the old one traded in; «Hangar» — fit what you bought.",
  "help.EQUIPMENT_SHOP.body2":
    "Purchases go to the warehouse — then slot them in on the «Hangar» tab," +
    " watching the mass: each hull has its own slots and capacity.",
  "help.EQUIPMENT_SHOP.control1": "Gear — buy weapons and modules",
  "help.EQUIPMENT_SHOP.control2":
    "Hull — swap your hull, trading in the old one",
  "help.EQUIPMENT_SHOP.control3": "Hangar — install what you bought",

  // --- onboarding: government ----------------------------------------------
  "help.GOVERNMENT.title": "Government",
  "help.GOVERNMENT.body1":
    "The local authorities hand out contracts and pay for services. Take a" +
    " suitable contract, complete it and return for the reward.",
  "help.GOVERNMENT.body2":
    "Completing contracts raises your reputation with this faction and opens" +
    " up new opportunities.",
  "help.GOVERNMENT.control1": "Take quest — accept a contract",
  "help.GOVERNMENT.control2": "Hand in — claim the reward",

  // --- onboarding: information center ---------------------------------------
  "help.INFO_CENTER.title": "Information Center",
  "help.INFO_CENTER.body1":
    "The galaxy's news hub: prices, rumors of lucrative deals, system intel" +
    " and wanted notices. Use it to plan your route.",
  "help.INFO_CENTER.body2":
    "Price rumors hint at where to carry goods; system data helps you avoid" +
    " flying into a hostile sector unprepared.",
  "help.INFO_CENTER.control1": "Search — find information",
  "help.INFO_CENTER.control2": "Rumors — learn about prices",

  // --- onboarding: bank ----------------------------------------------------
  "help.BANK.title": "Bank",
  "help.BANK.body1":
    "The bank holds savings at interest and grants loans against future" +
    " profit. A deposit grows every day; a loan accrues interest.",
  "help.BANK.body2":
    "Don't miss loan payments: arrears raise the rate, and a default hits" +
    " your reputation. Borrow wisely.",
  "help.BANK.control1": "Deposit — put money in",
  "help.BANK.control2": "Loan — borrow at interest",

  // --- onboarding: inventory -----------------------------------------------
  "help.INVENTORY.title": "Inventory & Equipment",
  "help.INVENTORY.body1":
    "Here is your cargo and ship equipment. Install modules by slot, move" +
    " items in and out of the hold, and inspect artifacts.",
  "help.INVENTORY.body2":
    "Watch your slots and mass — your equipment governs combat power, speed" +
    " and cargo capacity.",
  "help.INVENTORY.control1": "Drag and drop — install / remove",
  "help.INVENTORY.control2": "Slots — module banks",

  // --- onboarding: text quest ----------------------------------------------
  "help.TEXT_QUEST.title": "Text Adventure",
  "help.TEXT_QUEST.body1":
    "Before you is a story with choices. Read the text and pick an action —" +
    " your decisions affect the outcome and the reward.",
  "help.TEXT_QUEST.body2":
    "Sometimes the outcome depends on your ship's stats or what's in your" +
    " hold, so choose deliberately.",
  "help.TEXT_QUEST.control1": "Pick an option — continue the story",

  // --- onboarding: quest journal -------------------------------------------
  "help.quest-journal.title": "Quest Journal",
  "help.quest-journal.body1":
    "Your active quests are gathered here: what to do, where to fly and the" +
    " promised reward.",
  "help.quest-journal.body2":
    "Open a quest to see its objective and destination — then plot a route" +
    " on the star map.",
  "help.quest-journal.control1": "LMB on a quest — details",

  // --- onboarding: combat --------------------------------------------------
  "help.combat.title": "Real-Time Combat",
  "help.combat.body1":
    "Combat happens right in flight: your weapons fire automatically at the" +
    " nearest enemy within range, and enemies return fire.",
  "help.combat.body2":
    "Maneuver to keep your distance and stay out of the line of fire. Active" +
    " pause lets you take an aimed «Fire!» shot at the selected target.",
  "help.combat.control1": "Movement — maneuver in combat",
  "help.combat.control2": "«Fire!» — aimed shot on active pause",

  // --- onboarding: refuel ---------------------------------------------------
  "help.refuel.title": "Refueling",
  "help.refuel.body1":
    "Landing on a planet or docking at a station instantly and freely tops" +
    " off your fuel tank.",
  "help.refuel.body2":
    "The station's paid «Refuel» service only matters if you burn fuel" +
    " again in flight — right after landing or docking, the tank is already full.",
};
