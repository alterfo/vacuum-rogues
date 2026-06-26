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
  "menu.feedback": "Send Feedback",
  "menu.replayTutorial": "Replay Tutorial",
  "menu.tutorialReset": "Tutorial reset — hints will show again",
  "menu.engineUnavailable": "Error: game engine unavailable",
  "menu.loading": "Loading...",
  "menu.noSaves": "No saved games available",
  "menu.loadError": "Load failed. Start a new game.",

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
};
