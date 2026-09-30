// Fixed rules of the game mode. Everything the host can change in the setup menu (gold, points,
// limits, rarity chances, respawn, towers, courier, ...) lives in boost/config.ts instead.

export const GameSettings = {
    teamSize: 5,

    // Phases (seconds)
    heroSelectionTime: 30,
    // After every hero is picked (or the pick timer ends): both teams see each other's heroes before the pre-game
    strategyTime: 10,
    postGameTime: 60,

    // Bots that fill the lobby while testing in tools mode
    testBotHeroes: [
        "npc_dota_hero_lina",
        "npc_dota_hero_juggernaut",
        "npc_dota_hero_crystal_maiden",
        "npc_dota_hero_axe",
        "npc_dota_hero_sniper",
        "npc_dota_hero_lion",
        "npc_dota_hero_sven",
        "npc_dota_hero_zuus",
        "npc_dota_hero_tidehunter",
        "npc_dota_hero_drow_ranger",
    ],
};

/** Modify points a player earns for a kill (the multiplier, passive gain and costs are in the setup menu). */
export const PointsSettings = {
    // Hero kill: base, plus a bonus for every kill of the victim's streak from 3 on, up to a maximum
    perHeroKill: 125,
    perStreakKill: 25,
    maxStreakBonus: 250,
    streakBonusFrom: 3,

    perLaneCreep: 10,
    perNeutral: 10,

    // Paid to EVERY player of the team that destroyed it, by tower tier (1-4)
    perTowerTier: [0, 100, 200, 400, 500],
    perBarracks: 60,
    // Paid to every player of the team that killed Roshan
    perRoshan: 300,

    // Observer ward: from this near your own base to this deep in the enemy base
    perObserverPlacedMin: 25,
    perObserverPlacedMax: 75,
    perObserverDewarded: 50,

    perBountyRune: 25,
    perWaterRune: 25,
    perWisdomRune: 25,
    perPowerRune: 50,

    // Paid to EVERY player of the team that captured a watcher
    perWatcherCapture: 75,
    // Lotus picked up (item name contains "lotus"; unverified in game, see debug log)
    perLotus: 25,

    // Bots spend their points on random upgrades so both teams get stronger
    botsAutoUpgrade: true,

    // Print every point gain of human players to the console while testing
    debugLog: false,
};

/**
 * `multiplier` is how much bigger one click on a row is: a legendary row moves the stat 3 times as far as a
 * common one (user 2026-09-29; 2.25 was too close to epic). The chance of each rarity is set in the setup menu.
 * Stats with fixed clicks per rarity (percentages, proc chance: stat_limits rarityClicks) ignore these.
 */
export const RaritySettings: Record<Rarity, { multiplier: number }> = {
    common: { multiplier: 1 },
    rare: { multiplier: 1.5 },
    epic: { multiplier: 2 },
    legendary: { multiplier: 3 },
};

/** Order in which the rarity roll walks through the rarities. */
export const rarityOrder: Rarity[] = ["common", "rare", "epic", "legendary"];

/** Gold reasons that count as income and get multiplied. */
export const incomeGoldReasons: ModifyGoldReason[] = [
    ModifyGoldReason.BUILDING,
    ModifyGoldReason.HERO_KILL,
    ModifyGoldReason.CREEP_KILL,
    ModifyGoldReason.NEUTRAL_KILL,
    ModifyGoldReason.ROSHAN_KILL,
    ModifyGoldReason.BOUNTY_RUNE,
    ModifyGoldReason.SHARED_GOLD,
];
