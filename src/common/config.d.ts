/**
 * Game settings the host can change in the setup menu before the match.
 * The server owns the values, their limits and their defaults (src/vscripts/boost/config.ts) and
 * publishes a list of them, so the menu draws itself from that list. Toggles are 0 (off) or 1 (on).
 */

interface GameConfig {
    // Economy
    startingGold: number;
    goldPerMinute: number;
    /** Gold multipliers by source; goldMultiplier covers the rest (buildings, Roshan, runes, shared gold) */
    creepGoldMultiplier: number;
    neutralGoldMultiplier: number;
    heroGoldMultiplier: number;
    goldMultiplier: number;
    xpMultiplier: number;

    // Modify points
    pointsMultiplier: number;
    pointsPerMinute: number;
    /** Free modifications every player gets at the start (paid as points) */
    startingUpgrades: number;
    upgradeBaseCost: number;
    upgradeCostGrowth: number;
    /** Extra cost of every buff per 5 minutes of game time */
    upgradeCostPer5Minutes: number;

    // Limits: how often a skill can be modified
    /** Percent one common click changes a stat at minute 0, at the late minute, and that minute */
    buffSizeStart: number;
    buffSizeLate: number;
    buffSizeLateMinute: number;
    /** Smallest percent a common click is ever worth (lifts early game only) */
    buffSizeMin: number;
    /** 1 = cooldowns can be modified, 0 = no cooldown rows are offered */
    allowCooldown: number;
    /** Host toggles for kinds of buffs (1 = offered): disable and slow durations/slows, skill durations, unit counts, turn rate */
    allowDebuffs: number;
    allowSkillDurations: number;
    allowUnitCounts: number;
    allowTurnRate: number;
    allowTickRate: number;
    allowProcChance: number;
    /** 1 = items can be bought from any shop (secret and side shop items too) */
    universalShop: number;
    /** Game minute from which Aghanim's Shard can be bought (Dota default 15) */
    shardMinute: number;
    /** Team kills that end the game, 0 = off */
    killLimit: number;
    /** Minutes after which the game ends, 0 = off */
    timeLimit: number;

    /** Rows in each Modify list */
    rowsPerList: number;
    /** Seconds of pre-game countdown before the horn */
    preGameTime: number;

    // Rarity chances of a row in the Modify list (relative weights)
    rarityCommon: number;
    rarityRare: number;
    rarityEpic: number;
    rarityLegendary: number;

    // Death
    respawnScale: number;
    fixedRespawnTime: number;
    /** Flat max health every hero gains per game minute, up to healthGrowthMax */
    healthFlatPerMinute: number;
    healthGrowthMax: number;
    /** Armor every hero gains per 5 game minutes */
    armorPer5Minutes: number;
    randomRespawn: number;
    /** Longest respawn time in seconds; 0 = no limit */
    maxRespawnTime: number;

    // Randomness
    randomCooldown: number;

    // Towers
    towerHealthMultiplier: number;
    towerArmorBonus: number;
    /** Tower growth: % of starting health per minute up to a multiple, armor per 5 minutes up to a bonus */
    towerHealthPerMinute: number;
    towerHealthMaxGrowth: number;
    towerArmorPer5Minutes: number;
    towerArmorMaxGrowth: number;
    /** Tower attack damage: normal until the start minute, growing evenly to these multipliers at the full minute */
    towerDamageStartMinute: number;
    towerDamageFullMinute: number;
    towerDamageVsCreeps: number;
    towerDamageVsHeroes: number;
    towerDamageVsIllusions: number;

    // Courier
    courierSpeedMultiplier: number;
    flyingCourier: number;

    // Items
    teleportCooldown: number;
}

/** One line of the menu */
interface ConfigItem {
    key: string;
    label: string;
    /** Tab the line is listed under */
    group: string;
    /** Divider heading inside the tab */
    section: string;
    /** One short sentence for the (i) tooltip, if the setting needs explaining */
    help?: string;
    /** "number" is changed with - / + buttons, "toggle" is on or off */
    kind: "number" | "toggle";
    min: number;
    max: number;
    step: number;
    /** Digits after the decimal point when the value is shown */
    decimals: number;
}

interface ConfigSchema {
    items: ConfigItem[];
}

/** Names of the presets saved on this PC */
interface PresetList {
    names: string[];
}

/** Last message for the menu ("Saved", "Could not write the file", ...). Version changes with every message. */
interface SetupStatus {
    message: string;
    version: number;
}

interface CustomNetTableDeclarations {
    boost_config: { schema: ConfigSchema; values: GameConfig };
    boost_presets: { list: PresetList };
    boost_setup: { status: SetupStatus };
}
